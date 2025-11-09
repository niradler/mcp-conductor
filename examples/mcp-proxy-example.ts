import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: 'deno',
  args: ['run', '--allow-all', 'src/cli/cli.ts', 'stdio']
})

const client = new Client({
  name: 'mcp-proxy-example',
  version: '1.0.0'
}, {
  capabilities: {}
})

await client.connect(transport)

console.log('Connected to MCP Conductor')

const toolsList = await client.listTools()
console.log('Available tools:', toolsList.tools.map(t => t.name))

const mcpServers = await client.callTool({
  name: 'list_mcp_servers',
  arguments: {}
})
console.log('\nMCP Servers:', JSON.stringify(mcpServers, null, 2))

const codeResult = await client.callTool({
  name: 'run_deno_code',
  arguments: {
    deno_code: `
// Example using mcpFactory
const servers = ['github', 'slack'];

for (const serverName of servers) {
  try {
    const server = await mcpFactory.load(serverName);
    const tools = await server.listTools();
    console.log(\`\${serverName}: \${tools.length} tools\`);
  } catch (error) {
    console.log(\`\${serverName}: not available - \${error.message}\`);
  }
}

'MCP proxy example complete'
    `
  }
})

console.log('\nCode execution result:', codeResult)

await client.close()
console.log('Disconnected')

