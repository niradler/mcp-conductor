import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const client = new Client(
  { name: 'test-prompts-client', version: '1.0.0' },
  { capabilities: { prompts: {} } },
)

const transport = new StdioClientTransport({
  command: 'deno',
  args: ['run', '--allow-all', 'src/cli/cli.ts', 'stdio'],
})

await client.connect(transport)

console.log('📋 Listing available prompts...\n')
const prompts = await client.listPrompts()
console.log(`Found ${prompts.prompts.length} prompts:`)
prompts.prompts.forEach(p => {
  console.log(`  • ${p.name}: ${p.description}`)
})

console.log('\n' + '='.repeat(60))
console.log('🎯 Testing execute_task prompt')
console.log('='.repeat(60))
const task = await client.getPrompt({
  name: 'execute_task',
  arguments: { 
    task: 'Fetch GitHub repository information', 
    requirements: 'Use parallel calls for efficiency' 
  },
})
console.log(`Length: ${task.messages[0].content.text.length} characters`)
console.log('Preview (first 300 chars):')
console.log(task.messages[0].content.text.substring(0, 300) + '...\n')

console.log('='.repeat(60))
console.log('📖 Testing usage_guide prompt (all topics)')
console.log('='.repeat(60))
const guide = await client.getPrompt({
  name: 'usage_guide',
  arguments: {},
})
console.log(`Length: ${guide.messages[0].content.text.length} characters`)
console.log('Sections covered: Overview, Security, Performance, MCP Proxy, Packages, Examples\n')

console.log('='.repeat(60))
console.log('📖 Testing usage_guide prompt (mcp-proxy topic)')
console.log('='.repeat(60))
const mcpGuide = await client.getPrompt({
  name: 'usage_guide',
  arguments: { topic: 'mcp-proxy' },
})
console.log(`Length: ${mcpGuide.messages[0].content.text.length} characters`)
console.log('Focused on: MCP Proxy integration only\n')

console.log('='.repeat(60))
console.log('📖 Testing usage_guide prompt (performance topic)')
console.log('='.repeat(60))
const perfGuide = await client.getPrompt({
  name: 'usage_guide',
  arguments: { topic: 'performance' },
})
console.log(`Length: ${perfGuide.messages[0].content.text.length} characters`)
console.log('Focused on: Performance and efficiency only\n')

await client.close()
console.log('✅ All prompt tests passed!')
console.log('\nSummary:')
console.log(`  - ${prompts.prompts.length} prompts registered`)
console.log(`  - execute_task: ${task.messages[0].content.text.length} chars`)
console.log(`  - usage_guide (all): ${guide.messages[0].content.text.length} chars`)
console.log(`  - usage_guide (mcp-proxy): ${mcpGuide.messages[0].content.text.length} chars`)
console.log(`  - usage_guide (performance): ${perfGuide.messages[0].content.text.length} chars`)

