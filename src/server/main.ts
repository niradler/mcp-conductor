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
import { ensureWorkspaceDir } from '../executor/workspace.ts'
import { loadConfigFromEnv } from './config.ts'
import { MCPManager } from '../mcp-proxy/manager.ts'
import { MCPRPCServer } from '../mcp-proxy/rpc-server.ts'
import { generateMcpFactoryCode } from '../mcp-proxy/factory.ts'
import { createMCPProxyTools } from '../mcp-proxy/tools.ts'

const VERSION = '0.1.0'

async function autoCacheWorkspacePackages(workspaceDir: string): Promise<void> {
  try {
    const denoJsonPath = `${workspaceDir}/deno.json`

    try {
      await Deno.stat(denoJsonPath)
    } catch {
      return
    }

    console.error('📦 Found deno.json in workspace, caching packages...')

    // Read deno.json to get imports
    const denoJsonContent = await Deno.readTextFile(denoJsonPath)
    const denoJson = JSON.parse(denoJsonContent)
    const imports = denoJson.imports || {}

    if (Object.keys(imports).length === 0) {
      console.error('⚠️  No imports found in deno.json')
      return
    }

    // Create temporary file that imports all packages
    const tempCacheFile = `${workspaceDir}/.mcp-cache-deps.ts`
    const importStatements = Object.keys(imports)
      .map((pkg) => `import '${pkg}'`)
      .join('\n')

    await Deno.writeTextFile(tempCacheFile, importStatements)

    const cmd = new Deno.Command('deno', {
      args: ['cache', '--reload', '--config', denoJsonPath, tempCacheFile],
      cwd: workspaceDir,
      stdout: 'piped',
      stderr: 'piped',
    })

    const process = await cmd.output()

    // Clean up temp file
    try {
      await Deno.remove(tempCacheFile)
    } catch {
      // Ignore cleanup errors
    }

    if (process.code === 0) {
      console.error('✅ Workspace packages cached successfully')
    } else {
      const stderr = new TextDecoder().decode(process.stderr)
      console.error(`⚠️  Warning: Failed to cache packages: ${stderr}`)
    }
  } catch (error) {
    console.error(`⚠️  Warning: Error caching workspace packages: ${error}`)
  }
}

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

  const returnMode = finalConfig.returnMode ?? 'xml'

  const workspaceDir = await ensureWorkspaceDir(finalConfig.workspaceDir)
  console.error(`MCP Conductor workspace: ${workspaceDir}`)

  await autoCacheWorkspacePackages(workspaceDir)

  const runCode = new RunCode(defaultRunArgs, workspaceDir, finalConfig.maxReturnSize)

  if (mcpFactoryCode) {
    runCode.setMcpFactoryCode(mcpFactoryCode)
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
  const toolDescription =
    `Execute TypeScript/JavaScript in sandboxed Deno subprocess. Permissions set by admin via env vars.

**Deno Quick Reference**:

File System:
\`\`\`typescript
await Deno.writeTextFile("file.txt", "content");
const text = await Deno.readTextFile("file.txt");
const bytes = await Deno.readFile("file.bin");
\`\`\`

Commands:
\`\`\`typescript
const cmd = new Deno.Command("ls", { args: ["-la"] });
const { stdout } = await cmd.output();
const text = new TextDecoder().decode(stdout);
\`\`\`

Environment:
\`\`\`typescript
const key = Deno.env.get("API_KEY");
\`\`\`

Temporal (Date/Time):
\`\`\`typescript
const birthday = Temporal.PlainMonthDay.from("12-15");
const birthdayIn2030 = birthday.toPlainDate({ year: 2030 });
\`\`\`

Imports
\`\`\`typescript
import { serve } from "jsr:@std/http";
import axios from "npm:axios@^1";
\`\`\`

Globals: \`Deno.exit()\`, \`import.meta.dirname\`, no \`require()\` or \`__dirname\`

**MCP Factory** (call other MCP servers):
\`\`\`typescript
if (typeof mcpFactory !== 'undefined') {
  const github = await mcpFactory.load('github');
  if (github) {
    const data = await github.callTool('tool_name', { params });
  }
}
\`\`\`

**Alternative Discovery Tools**: You can also use the \`list_mcp_servers\` and \`get_tools\` tools (outside of code execution) to discover available MCP servers and get detailed tool information before writing code.

Last expression is returned as result.
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
          'Execution timeout in milliseconds (default: 30000, max: 600000)',
        ),
      },
    },
    async ({
      deno_code,
      timeout,
    }: {
      deno_code: string
      timeout?: number
    }) => {
      const logPromises: Promise<void>[] = []

      const result = await runCode.run(
        {
          code: deno_code,
          timeout: timeout ?? finalConfig.defaultTimeout,
        },
        (level, data) => {
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

      await Promise.all(logPromises)

      return {
        content: [{
          type: 'text',
          text: returnMode === 'xml'
            ? await asXml(result, workspaceDir, finalConfig.maxReturnSize)
            : asJson(result),
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
        inputSchema: proxyTools.list_mcp_servers.tool.inputSchema,
      },
      async () => {
        const result = await proxyTools.list_mcp_servers.handler()
        return {
          content: [{
            type: 'text',
            text: returnMode === 'xml'
              ? `<servers>${JSON.stringify(result.servers, null, 2)}</servers>`
              : JSON.stringify(result),
          }],
        }
      },
    )

    server.registerTool(
      'get_tools',
      {
        title: proxyTools.get_tools.tool.title,
        description: proxyTools.get_tools.tool.description,
        inputSchema: proxyTools.get_tools.tool.inputSchema,
      },
      async ({ server: serverName, tools }: { server: string; tools?: string[] }) => {
        const result = await proxyTools.get_tools.handler({ server: serverName, tools })
        return {
          content: [{
            type: 'text',
            text: returnMode === 'xml'
              ? `<tools>${JSON.stringify(result.tools, null, 2)}</tools>`
              : JSON.stringify(result),
          }],
        }
      },
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

  const runCode = new RunCode([], '/tmp')
  const result = await runCode.run({
    code,
    permissions: {},
    timeout: 5000,
  })

  console.error('\nExecution Result:')
  console.error(await asXml(result, '/tmp'))

  if (result.status !== 'success') {
    Deno.exit(1)
  }
}
