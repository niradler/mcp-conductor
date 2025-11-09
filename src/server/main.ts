/**
 * MCP Server for running Deno code
 * Implements the Model Context Protocol with a tool for executing TypeScript/JavaScript
 */

/// <reference types="npm:@types/node@22.12.0" />

import http from 'node:http'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js'
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'npm:zod@^3.23.8'

import { asJson, asXml, RunCode } from '../executor/runCode.ts'
import type { ServerConfig } from '../types/types.ts'
import { DEFAULT_ALLOWED_DEPENDENCIES, validateDependencies } from '../executor/allowlist.ts'
import { ensureWorkspaceDir } from '../executor/workspace.ts'
import { loadConfigFromEnv } from './config.ts'
import { MCPManager } from '../mcp-proxy/manager.ts'
import { MCPRPCServer } from '../mcp-proxy/rpc-server.ts'
import { generateMcpFactoryCode } from '../mcp-proxy/factory.ts'
import { createMCPProxyTools } from '../mcp-proxy/tools.ts'

const VERSION = '0.1.0'

/**
 * Create and configure the MCP server
 */
export async function createServer(config: ServerConfig = {}): Promise<McpServer> {
  // Load configuration from environment variables (merge with provided config)
  const envConfig = loadConfigFromEnv()
  const finalConfig = {
    ...envConfig,
    ...config, // Provided config takes precedence
  }

  // Get default run args (used when no permissions specified)
  const defaultRunArgs = finalConfig.defaultRunArgs ?? []

  // Initialize MCP proxy manager with error handling
  let mcpManager: MCPManager | null = null
  let mcpRPCServer: MCPRPCServer | null = null
  let mcpFactoryCode: string | null = null

  try {
    mcpManager = new MCPManager()
    await mcpManager.initialize()

    const serverList = mcpManager.listServers()
    if (serverList.length > 0) {
      mcpRPCServer = new MCPRPCServer(mcpManager)
      const rpcPort = await mcpRPCServer.start()
      const authToken = mcpRPCServer.getAuthToken()
      mcpFactoryCode = generateMcpFactoryCode(rpcPort, authToken)
    }
  } catch (err) {
    console.error('Failed to initialize MCP proxy:', err)
    // Cleanup any resources that were created
    if (mcpRPCServer) {
      try {
        await mcpRPCServer.stop()
      } catch (stopErr) {
        console.error('Error stopping RPC server during cleanup:', stopErr)
      }
    }
    if (mcpManager) {
      try {
        await mcpManager.shutdown()
      } catch (shutdownErr) {
        console.error('Error shutting down manager during cleanup:', shutdownErr)
      }
    }
    mcpManager = null
    mcpRPCServer = null
    mcpFactoryCode = null
  }

  // Create executor with default run args
  const runCode = new RunCode(defaultRunArgs)

  // Set MCP factory code if available
  if (mcpFactoryCode) {
    runCode.setMcpFactoryCode(mcpFactoryCode)
  }

  const returnMode = finalConfig.returnMode ?? 'xml'

  // Ensure workspace directory exists
  const workspaceDir = await ensureWorkspaceDir(finalConfig.workspaceDir)
  console.error(`MCP Conductor workspace: ${workspaceDir}`)

  // Get allowed dependencies list
  const allowedDependencies = finalConfig.allowedDependencies ?? DEFAULT_ALLOWED_DEPENDENCIES
  const isRestrictive = Array.isArray(allowedDependencies)

  if (isRestrictive) {
    console.error(`Dependency allowlist enabled: ${allowedDependencies.length} packages allowed`)
  } else {
    console.error('⚠️  WARNING: All dependencies allowed (allowedDependencies: true)')
  }

  if (defaultRunArgs.length > 0) {
    console.error(`Default run args: ${defaultRunArgs.join(' ')}`)
  } else {
    console.error('🔒 Default permissions: NONE (zero permissions - most secure)')
  }

  const server = new McpServer(
    {
      name: 'MCP Run Deno',
      version: VERSION,
    },
    {
      instructions:
        'Call the "run_deno_code" tool to execute TypeScript/JavaScript code in a Deno sandbox.',
      capabilities: {
        logging: {},
      },
    },
  )

  let setLogLevel: LoggingLevel = 'emergency'

  // Handle logging level changes
  server.server.setRequestHandler(SetLevelRequestSchema, (request) => {
    setLogLevel = request.params.level
    return {}
  })

  // Define the tool schema
  const toolDescription = `Execute TypeScript or JavaScript code in a sandboxed Deno subprocess.

Permissions are configured by the server administrator via environment variables.
You cannot specify custom permissions - this is controlled for security.

**Deno-Specific Conventions** (different from Node.js):
- Use explicit file extensions in imports: \`import { foo } from "./bar.ts"\` (not "./bar")
- Use \`Deno.readTextFile()\` instead of \`fs.readFileSync()\`
- Use \`fetch()\` for HTTP requests
- NPM packages: \`import axios from "npm:axios@^1"\`
- JSR packages: \`import { join } from "jsr:@std/path"\`
- No node_modules - dependencies are cached globally by Deno

Features:
- Full TypeScript and modern JavaScript support
- Async/await support (code is wrapped in an async IIFE)
- Timeout protection
- Return value capture from last expression
- stdout/stderr capture
- Dependency management (NPM/JSR packages)

Security:
- Runs in isolated subprocess with permissions set by administrator
- Configurable timeouts prevent infinite loops
- Each execution is in a fresh environment
- Dependency allowlist enforced

The last expression in your code will be returned as the result.
`

  // Register the run_deno_code tool
  server.registerTool(
    'run_deno_code',
    {
      title: 'Run Deno Code',
      description: toolDescription,
      inputSchema: {
        deno_code: z.string().describe('TypeScript or JavaScript code to execute'),
        timeout: z.number().optional().describe(
          'Execution timeout in milliseconds (default: 30000, max: 300000)',
        ),
        globals: z.record(z.string(), z.any()).optional().describe(
          'Global variables to inject into execution context',
        ),
        dependencies: z.array(z.string()).optional().describe(
          'NPM or JSR dependencies to install (e.g., ["npm:axios@1.6.0", "jsr:@std/path"]). Must be in the server allowlist.',
        ),
      },
    },
    async ({
      deno_code,
      timeout,
      globals,
      dependencies,
    }: {
      deno_code: string
      timeout?: number
      globals?: Record<string, unknown>
      dependencies?: string[]
    }) => {
      const logPromises: Promise<void>[] = []

      // Validate dependencies against allowlist
      let enrichedDependencies = dependencies
      if (dependencies && dependencies.length > 0) {
        const validation = validateDependencies(dependencies, allowedDependencies)
        if (!validation.valid) {
          return {
            content: [{
              type: 'text',
              text:
                `<status>error</status>\n<error>\n<type>dependency-not-allowed</type>\n<message>The following dependencies are not allowed:\n\n${validation.errors.join('\n')
                }\n\nAllowed dependencies: ${isRestrictive ? allowedDependencies.join(', ') : 'all'
                }</message>\n</error>`,
            }],
          }
        }
        // Use enriched dependencies with versions from allowlist
        enrichedDependencies = validation.enriched
      }

      // Execute the code (permissions come from default run args set by env vars)
      const result = await runCode.run(
        {
          code: deno_code,
          // Don't pass permissions - they come from defaultRunArgs in constructor
          timeout: timeout ?? finalConfig.defaultTimeout,
          globals,
          dependencies: enrichedDependencies, // Use enriched dependencies
        },
        (level, data) => {
          // Only log if level meets threshold
          const levels: LoggingLevel[] = [
            'debug',
            'info',
            'notice',
            'warning',
            'error',
            'critical',
            'alert',
            'emergency',
          ]
          if (levels.indexOf(level) >= levels.indexOf(setLogLevel)) {
            logPromises.push(server.server.sendLoggingMessage({ level, data }))
          }
        },
      )

      // Wait for all log messages to be sent
      await Promise.all(logPromises)

      // Return result in requested format
      return {
        content: [{
          type: 'text',
          text: returnMode === 'xml' ? asXml(result) : asJson(result),
        }],
      }
    },
  )

  // Register MCP proxy tools if manager is available
  if (mcpManager) {
    const proxyTools = createMCPProxyTools(mcpManager)

    server.registerTool(
      'list_mcp_servers',
      {
        title: proxyTools.list_mcp_servers.tool.title,
        description: proxyTools.list_mcp_servers.tool.description,
        inputSchema: proxyTools.list_mcp_servers.tool.inputSchema
      },
      async () => {
        const result = await proxyTools.list_mcp_servers.handler()
        return {
          content: [{
            type: 'text',
            text: returnMode === 'xml'
              ? `<servers>${JSON.stringify(result.servers, null, 2)}</servers>`
              : JSON.stringify(result)
          }]
        }
      }
    )

    server.registerTool(
      'get_tool_details',
      {
        title: proxyTools.get_tool_details.tool.title,
        description: proxyTools.get_tool_details.tool.description,
        inputSchema: proxyTools.get_tool_details.tool.inputSchema
      },
      async ({ server: serverName, tools }: { server: string; tools?: string[] }) => {
        const result = await proxyTools.get_tool_details.handler({ server: serverName, tools })
        return {
          content: [{
            type: 'text',
            text: returnMode === 'xml'
              ? `<tools>${JSON.stringify(result.tools, null, 2)}</tools>`
              : JSON.stringify(result)
          }]
        }
      }
    )
  }

  // Store references for cleanup
  const serverWithCleanup = server as McpServer & {
    _mcpManager?: MCPManager | null
    _mcpRPCServer?: MCPRPCServer | null
  }
  serverWithCleanup._mcpManager = mcpManager
  serverWithCleanup._mcpRPCServer = mcpRPCServer

  return server
}

/**
 * Run the MCP server with stdio transport
 */
export async function runStdio(config: ServerConfig = {}): Promise<void> {
  const server = await createServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

/**
 * Run the MCP server with streamable HTTP transport
 */
export async function runStreamableHttp(port: number, config: ServerConfig = {}): Promise<void> {
  const mcpServer = await createServer(config)
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {}

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    let pathMatch = false

    function match(method: string, path: string): boolean {
      if (url.pathname === path) {
        pathMatch = true
        return req.method === method
      }
      return false
    }

    // Helper to get request body
    function getBody(): Promise<unknown> {
      return new Promise((resolve) => {
        const bodyParts: Buffer[] = []
        req.on('data', (chunk: Buffer) => {
          bodyParts.push(chunk)
        }).on('end', () => {
          const body = Buffer.concat(bodyParts).toString()
          resolve(JSON.parse(body))
        })
      })
    }

    // Helper for session requests
    async function handleSessionRequest() {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (!sessionId || !transports[sessionId]) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/plain')
        res.end('Invalid or missing session ID\n')
        return
      }

      const transport = transports[sessionId]
      await transport.handleRequest(req, res)
    }

    // Route handling
    if (match('POST', '/mcp')) {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      let transport: StreamableHTTPServerTransport

      const body = await getBody()

      if (sessionId && transports[sessionId]) {
        // Reuse existing transport
        transport = transports[sessionId]
      } else if (!sessionId && isInitializeRequest(body)) {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            transports[sessionId] = transport
          },
        })

        // Clean up on close
        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId]
          }
        }

        await mcpServer.connect(transport)
      } else {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
            id: null,
          }),
        )
        return
      }

      await transport.handleRequest(req, res, body)
    } else if (match('GET', '/mcp')) {
      await handleSessionRequest()
    } else if (match('DELETE', '/mcp')) {
      await handleSessionRequest()
    } else if (pathMatch) {
      res.statusCode = 405
      res.setHeader('Content-Type', 'text/plain')
      res.end('Method not allowed\n')
    } else {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain')
      res.end('Page not found\n')
    }
  })

  httpServer.listen(port, () => {
    console.error(`MCP Run Deno server listening on port ${port}`)
  })
}

/**
 * Run a simple example to verify the server works
 */
export async function runExample(): Promise<void> {
  console.error('Running MCP Run Deno example...')

  const code = `
// Example: Calculate factorial
function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1)
}

const result = factorial(10)
console.log('Factorial of 10:', result)

// Return result
result
`

  const runCode = new RunCode()
  const result = await runCode.run({
    code,
    permissions: {},
    timeout: 5000,
  })

  console.error('\nExecution Result:')
  console.error(asXml(result))

  if (result.status !== 'success') {
    Deno.exit(1)
  }
}
