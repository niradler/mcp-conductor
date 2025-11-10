/**
 * Example demonstrating MCP client integration with mcp-run-deno
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

console.log('=== MCP Client Integration Example ===\n')

// Note: This example requires the mcp-run-deno server to be built and accessible
// Run: deno task start stdio

// In a real scenario, you would spawn the server process
// For this example, we'll show the code structure

async function runMCPExample() {
  // Create transport to communicate with the MCP server
  const transport = new StdioClientTransport({
    command: 'deno',
    args: ['run', '--allow-all', 'src/cli/cli.ts', 'stdio'],
  })

  // Create MCP client
  const client = new Client(
    {
      name: 'example-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    },
  )

  // Connect client to server
  await client.connect(transport)

  try {
    // List available tools
    console.log('1. Listing available tools...')
    const tools = await client.listTools()
    console.log('Available tools:', tools.tools.map((t) => t.name))
    console.log()

    // Call the run_deno_code tool
    console.log('2. Executing Deno code via MCP...')
    const result = await client.callTool({
      name: 'run_deno_code',
      arguments: {
        deno_code: `
          const fibonacci = (n: number): number => {
            if (n <= 1) return n
            return fibonacci(n - 1) + fibonacci(n - 2)
          }
          
          const result = fibonacci(10)
          console.log(\`Fibonacci(10) = \${result}\`)
          result
        `,
        permissions: {},
        timeout: 5000,
      },
    })

    console.log('Tool result:')
    console.log((result.content as Array<{ type: string; text: string }>)[0])
    console.log()

    // Example with network permission
    console.log('3. Executing code with network permission...')
    const result2 = await client.callTool({
      name: 'run_deno_code',
      arguments: {
        deno_code: `
          const response = await fetch('https://deno.com')
          response.status
        `,
        permissions: {
          net: ['deno.com'],
        },
        timeout: 10000,
      },
    })

    console.log('Network request result:')
    console.log((result2.content as Array<{ type: string; text: string }>)[0])
    console.log()

    console.log('=== MCP Client Example Complete ===')
  } finally {
    await client.close()
  }
}

// Run the example
if (import.meta.main) {
  try {
    await runMCPExample()
  } catch (error) {
    console.error('Error:', error)
    Deno.exit(1)
  }
}
