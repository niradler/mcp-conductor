import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'npm:zod@^3.23.8'

import { asJson, asXml, RunCode } from '../executor/runCode.ts'
import type { ServerConfig } from '../types/types.ts'
import type { MCPManager } from '../mcp-proxy/manager.ts'
import { createMCPProxyTools } from '../mcp-proxy/tools.ts'

const DENO_CODE_TOOL_DESCRIPTION =
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

export function registerRunDenoCodeTool(
  server: McpServer,
  runCode: RunCode,
  config: ServerConfig,
  workspaceDir: string,
  getLogLevel: () => LoggingLevel,
): void {
  const returnMode = config.returnMode ?? 'xml'
  server.registerTool(
    'run_deno_code',
    {
      title: 'Run Deno Code',
      description: DENO_CODE_TOOL_DESCRIPTION,
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
          timeout: timeout ?? config.defaultTimeout,
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
          if (levels.indexOf(level) >= levels.indexOf(getLogLevel())) {
            logPromises.push(server.server.sendLoggingMessage({ level, data }))
          }
        },
      )

      await Promise.all(logPromises)

      return {
        content: [{
          type: 'text',
          text: returnMode === 'xml'
            ? await asXml(result, workspaceDir, config.maxReturnSize)
            : asJson(result),
        }],
      }
    },
  )
}

export function registerMCPProxyTools(
  server: McpServer,
  mcpManager: MCPManager,
  returnMode: 'xml' | 'json',
): void {
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
