import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'npm:zod@^3.23.8'

import { asJson, asYaml, RunCode } from '../executor/runCode.ts'
import type { ServerConfig } from '../types/types.ts'
import type { MCPManager } from '../mcp-proxy/manager.ts'
import { createMCPProxyTools } from '../mcp-proxy/tools.ts'
import { createPlaybook, getPlaybook, listPlaybooks } from '../executor/playbook.ts'

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

**Injected Globals** (available in your code):
\`\`\`typescript
// Workspace and playbooks directories
const workspace = globalThis.WORKSPACE_DIR;  // Your working directory
const playbooks = globalThis.PLAYBOOKS_DIR;  // Playbooks location
const rootDir = globalThis.ROOT_DIR;         // MCP Conductor root

// Permission flags (array of strings)
const perms = globalThis.PERMISSIONS;        // e.g., ["--allow-read=/path", "--allow-net"]

// Helper function to import playbooks
const utils = await importPlaybook('http-utilities');  // Returns module exports
\`\`\`

**Playbooks** (reusable patterns):
\`\`\`typescript
// List available playbooks first with list_playbooks tool

// Import from a playbook using the helper function
const { fetchJSON } = await importPlaybook('http-utilities');

const data = await fetchJSON('https://api.example.com/data', {
  retries: 3,
  timeout: 5000
});
\`\`\`

Globals: \`Deno.exit()\`, \`import.meta.dirname\`, \`WORKSPACE_DIR\`, \`PLAYBOOKS_DIR\`, \`ROOT_DIR\`, \`PERMISSIONS\`, \`importPlaybook(name)\`, no \`require()\` or \`__dirname\`

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
          text: returnMode === 'yaml'
            ? await asYaml(result, workspaceDir, config.maxReturnSize)
            : asJson(result),
        }],
      }
    },
  )
}

export function registerMCPProxyTools(
  server: McpServer,
  mcpManager: MCPManager,
  returnMode: 'yaml' | 'json',
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
          text: returnMode === 'yaml'
            ? `servers:\n${JSON.stringify(result.servers, null, 2)}`
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
          text: returnMode === 'yaml'
            ? `tools:\n${JSON.stringify(result.tools, null, 2)}`
            : JSON.stringify(result),
        }],
      }
    },
  )
}

export function registerPlaybookTools(server: McpServer, rootDir: string): void {
  server.registerTool(
    'list_playbooks',
    {
      title: 'List Available Playbooks',
      description:
        'List all available playbooks with their names and descriptions. Playbooks are reusable code patterns and utilities stored in the playbooks directory.',
      inputSchema: {},
    },
    async () => {
      const playbooks = await listPlaybooks(rootDir)

      return {
        content: [{
          type: 'text',
          text: playbooks.length === 0
            ? 'No playbooks found. Create your first playbook using create_playbook tool.'
            : `# Available Playbooks (${playbooks.length})\n\n` +
              playbooks.map((p) =>
                `## ${p.name}\n**Folder:** ${p.folderName}\n**Description:** ${p.description}\n**Has Code:** ${
                  p.hasCode ? 'Yes' : 'No'
                }\n`
              ).join('\n'),
        }],
      }
    },
  )

  server.registerTool(
    'get_playbook',
    {
      title: 'Get Playbook Content',
      description:
        'Retrieve the full content of a specific playbook including documentation and code path. Use the folder name from list_playbooks.',
      inputSchema: {
        folder_name: z.string().describe('Folder name of the playbook (from list_playbooks)'),
      },
    },
    async ({ folder_name }: { folder_name: string }) => {
      try {
        const playbook = await getPlaybook(rootDir, folder_name)

        let output = `# ${playbook.metadata.name}\n\n`

        if (playbook.metadata.author) {
          output += `**Author:** ${playbook.metadata.author}\n`
        }
        if (playbook.metadata.version) {
          output += `**Version:** ${playbook.metadata.version}\n`
        }
        if (playbook.metadata.tags && playbook.metadata.tags.length > 0) {
          output += `**Tags:** ${playbook.metadata.tags.join(', ')}\n`
        }

        output += `\n---\n\n${playbook.content}\n\n---\n\n`
        output += `## Code Path\n\nImport utilities from: \`${playbook.codePath}\`\n\n`
        output +=
          `Example:\n\`\`\`typescript\nimport { yourFunction } from "${playbook.codePath}"\n\`\`\``

        return {
          content: [{
            type: 'text',
            text: output,
          }],
        }
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'create_playbook',
    {
      title: 'Create New Playbook',
      description:
        'Create a new playbook with documentation and optional TypeScript code. Playbooks are stored in the playbooks directory and can be imported in code executions.',
      inputSchema: {
        folder_name: z.string().describe('Folder name (alphanumeric, hyphens, underscores only)'),
        name: z.string().describe('Display name of the playbook'),
        description: z.string().describe('Short description of what this playbook does'),
        content: z.string().describe('Markdown content documenting usage, examples, patterns'),
        code: z.string().optional().describe('TypeScript/JavaScript code to include (optional)'),
        author: z.string().optional().describe('Author name (optional)'),
        version: z.string().optional().describe('Version string (optional)'),
        tags: z.array(z.string()).optional().describe('Tags for categorization (optional)'),
      },
    },
    async ({
      folder_name,
      name,
      description,
      content,
      code,
      author,
      version,
      tags,
    }: {
      folder_name: string
      name: string
      description: string
      content: string
      code?: string
      author?: string
      version?: string
      tags?: string[]
    }) => {
      try {
        if (!/^[a-zA-Z0-9_-]+$/.test(folder_name)) {
          throw new Error(
            'Folder name must contain only alphanumeric characters, hyphens, and underscores',
          )
        }

        const folderPath = await createPlaybook(
          rootDir,
          folder_name,
          { name, description, author, version, tags },
          content,
          code,
        )

        return {
          content: [{
            type: 'text',
            text:
              `✅ Playbook created successfully!\n\n**Path:** ${folderPath}\n**Name:** ${name}\n\nUse \`get_playbook\` with folder_name="${folder_name}" to view it.`,
          }],
        }
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        }
      }
    },
  )
}
