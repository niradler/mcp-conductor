import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'npm:zod@^3.23.8'

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'execute_task',
    {
      title: 'Execute Task with Code',
      description:
        'Execute any task using TypeScript/JavaScript in a secure Deno sandbox with access to MCP servers, packages, and APIs',
      argsSchema: {
        task: z.string().describe('What you want to accomplish'),
        requirements: z.string().optional().describe('Specific requirements or constraints'),
      },
    },
    ({ task, requirements }: { task: string; requirements?: string }) => {
      const reqPart = requirements ? `\n\n**Requirements:** ${requirements}` : ''

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `# Task
${task}${reqPart}

# Solution Approach

Write TypeScript/JavaScript code using the \`run_deno_code\` tool. Follow these principles for maximum effectiveness:

## 🎯 Token Efficiency (Critical!)

**Always combine multiple operations in ONE execution:**
\`\`\`typescript
// ✅ GOOD - Single execution with all operations
const results = await Promise.all([
  fetch('https://api1.com/data'),
  fetch('https://api2.com/data'),
  fetch('https://api3.com/data')
])
// Process all results
return { data: results }

// ❌ BAD - Multiple separate tool calls (wastes tokens)
// Don't call run_deno_code multiple times when one call can do it all!
\`\`\`

## 🔌 MCP Proxy - Call Other MCP Servers

You can call OTHER MCP servers from within your code using \`mcpFactory\`:

\`\`\`typescript
if (typeof mcpFactory !== 'undefined') {
  // Load any available MCP server
  const github = await mcpFactory.load('github')
  const filesystem = await mcpFactory.load('filesystem')
  
  // Call tools from those servers
  const repos = await github.callTool('search_repositories', {
    query: 'deno language:typescript'
  })
  
  const file = await filesystem.callTool('read_file', {
    path: '/workspace/data.json'
  })
  
  // Combine data from multiple MCP servers!
  return { repos, file }
}
\`\`\`

**To discover available servers:** Use \`list_mcp_servers\` and \`get_tools\` tools BEFORE writing code.

## 📦 Package Imports

\`\`\`typescript
// NPM packages
import axios from 'npm:axios@^1.6.0'
import lodash from 'npm:lodash@^4.17.21'

// JSR packages (Deno-native)
import { serve } from 'jsr:@std/http'
import { assertEquals } from 'jsr:@std/assert'
\`\`\`

## 🚀 Performance Patterns

**Parallel Operations:**
\`\`\`typescript
// Execute multiple async operations simultaneously
const [data1, data2, data3] = await Promise.all([
  operation1(),
  operation2(),
  operation3()
])
\`\`\`

**Early Returns:**
\`\`\`typescript
// Stop processing when you have what you need
for (const item of largeArray) {
  if (results.length >= 10) break
  if (matches(item)) results.push(item)
}
\`\`\`

## 🔐 Security & Flexibility

**Graceful Permission Handling:**
\`\`\`typescript
// Try to use available permissions, fall back if denied
try {
  await Deno.writeTextFile('output.json', data)
  console.log('✅ Saved to file')
} catch {
  console.log('📋 Result:', data)
  // Continue without file access
}
\`\`\`

**Feature Detection:**
\`\`\`typescript
// Adapt to available capabilities
const hasMCP = typeof mcpFactory !== 'undefined'
if (hasMCP) {
  // Use MCP servers for data
} else {
  // Fall back to direct API calls
}
\`\`\`

## 🎨 Code Structure

\`\`\`typescript
// 1. Validation
if (!input) throw new Error('Missing required input')

// 2. Main logic with error handling
try {
  // Parallel operations for performance
  const results = await Promise.all([
    // Your operations here
  ])
  
  // Process results
  const processed = results.map(r => transform(r))
  
  // Optional: Try to save with graceful fallback
  try {
    await Deno.writeTextFile('output.json', JSON.stringify(processed))
  } catch {
    // No file permission - that's ok
  }
  
  // 3. Return structured, informative result
  return {
    success: true,
    data: processed,
    count: processed.length,
    performance: { operations: results.length }
  }
} catch (error) {
  return {
    success: false,
    error: error.message
  }
}
\`\`\`

## Available Deno APIs

- **Files:** \`Deno.readTextFile()\`, \`Deno.writeTextFile()\`, \`Deno.readDir()\`
- **HTTP:** Native \`fetch()\` API
- **Commands:** \`new Deno.Command(cmd, { args })\`
- **Time:** \`Temporal.Now.instant()\`, \`performance.now()\`

## Return Values

The last expression is automatically returned. Return structured data:
\`\`\`typescript
return {
  success: true,
  data: results,
  metadata: { count: results.length, timestamp: Date.now() }
}
\`\`\`

---

**Now solve the task above using these principles. Be efficient, secure, and flexible.**`,
            },
          },
        ],
      }
    },
  )

  server.registerPrompt(
    'usage_guide',
    {
      title: 'MCP Conductor Usage Guide',
      description:
        'Comprehensive guide on using MCP Conductor effectively: security, performance, MCP proxy, packages, and best practices',
      argsSchema: {
        topic: z.string().optional().describe(
          'Specific topic: security, performance, mcp-proxy, packages, or all (default)',
        ),
      },
    },
    ({ topic }: { topic?: string }) => {
      const t = topic?.toLowerCase() || 'all'
      const showAll = t === 'all'

      let guide = `# MCP Conductor - Complete Usage Guide

MCP Conductor executes TypeScript/JavaScript code in a secure Deno sandbox with unique capabilities that make it powerful for LLM agents.

`

      if (showAll || t === 'overview' || t === 'key-features') {
        guide += `## 🌟 What Makes This Special

**1. Token Efficiency**
- Execute complex multi-step workflows in ONE tool call
- Combine operations that would normally require 5-10 separate tools
- Save tokens and improve response speed

**2. MCP Proxy Integration**
- Call OTHER MCP servers from within your code
- Combine data from multiple sources (GitHub + Filesystem + Slack, etc.)
- Chain operations across different MCP servers seamlessly

**3. Secure by Default**
- Zero permissions unless admin grants them
- Two-process isolation (server vs user code)
- Graceful degradation when permissions denied

**4. Maximum Flexibility**
- Use NPM/JSR packages on the fly
- Adapt behavior based on available permissions
- Works with or without file/network access

---

`
      }

      if (showAll || t === 'security') {
        guide += `## 🔒 Security Model

**Core Principles:**
- **Zero Trust:** No permissions by default
- **Admin Controlled:** Permissions set via environment variables, NOT by LLM
- **Process Isolation:** User code runs in separate subprocess
- **Timeout Protection:** Default 30s, max 5min

**Permission Scope:**
\`\`\`typescript
// Code runs but actions require permissions
console.log('Always works') // ✅
await Deno.readTextFile('file.txt') // ❌ Needs --allow-read
await fetch('https://api.com') // ❌ Needs --allow-net
\`\`\`

**Best Practice - Graceful Degradation:**
\`\`\`typescript
try {
  const data = await riskyOperation()
  return { success: true, data }
} catch (error) {
  console.log('Permission denied, using alternative approach')
  return { success: true, data: alternativeApproach() }
}
\`\`\`

**Input Validation:**
\`\`\`typescript
function validate(input: string): string {
  if (typeof input !== 'string' || input.length > 10000) {
    throw new Error('Invalid input')
  }
  return input.replace(/[<>]/g, '') // Sanitize
}
\`\`\`

---

`
      }

      if (showAll || t === 'performance' || t === 'efficiency') {
        guide += `## ⚡ Performance & Token Efficiency

**Rule #1: Combine Operations**
\`\`\`typescript
// ❌ BAD - 3 separate tool calls = expensive
await run_deno_code({ code: 'step1()' })
await run_deno_code({ code: 'step2()' })
await run_deno_code({ code: 'step3()' })

// ✅ GOOD - 1 tool call = efficient
await run_deno_code({ 
  code: \`
    await step1()
    await step2()
    await step3()
  \`
})
\`\`\`

**Rule #2: Use Parallel Operations**
\`\`\`typescript
// Execute multiple operations simultaneously
const [repos, issues, prs] = await Promise.all([
  github.callTool('list_repos', {}),
  github.callTool('list_issues', {}),
  github.callTool('list_pulls', {})
])
// 3x faster than sequential!
\`\`\`

**Rule #3: Cache and Reuse**
\`\`\`typescript
const cache = new Map()

async function getData(key: string) {
  if (cache.has(key)) return cache.get(key)
  const data = await expensiveFetch(key)
  cache.set(key, data)
  return data
}
\`\`\`

**Rule #4: Early Termination**
\`\`\`typescript
for (const item of hugeArray) {
  if (results.length >= 10) break // Stop when done
  if (matches(item)) results.push(item)
}
\`\`\`

**Performance Monitoring:**
\`\`\`typescript
const start = performance.now()
const result = await operation()
const duration = performance.now() - start
console.log(\`Completed in \${duration.toFixed(2)}ms\`)
\`\`\`

---

`
      }

      if (showAll || t === 'mcp-proxy' || t === 'mcp') {
        guide += `## 🔌 MCP Proxy - The Game Changer

Call OTHER MCP servers from within your code execution!

**Discovery:**
\`\`\`typescript
// Check what's available
if (typeof mcpFactory !== 'undefined') {
  const servers = await mcpFactory.listServers()
  console.log('Available:', servers)
}
\`\`\`

**Loading and Calling:**
\`\`\`typescript
// Load server once
const github = await mcpFactory.load('github')

// Call multiple tools from same server
const user = await github.callTool('get_user', { username: 'denoland' })
const repos = await github.callTool('list_repos', { org: 'denoland' })
\`\`\`

**Parallel MCP Calls:**
\`\`\`typescript
const github = await mcpFactory.load('github')

// Execute multiple MCP tools simultaneously
const [user, repos, issues] = await Promise.all([
  github.callTool('get_user', { username: 'denoland' }),
  github.callTool('list_repos', { org: 'denoland' }),
  github.callTool('search_issues', { query: 'is:open label:bug' })
])
\`\`\`

**Combining Multiple MCP Servers:**
\`\`\`typescript
if (typeof mcpFactory !== 'undefined') {
  // Load multiple servers
  const github = await mcpFactory.load('github')
  const fs = await mcpFactory.load('filesystem')
  const slack = await mcpFactory.load('slack')
  
  // 1. Get data from GitHub
  const issues = await github.callTool('list_issues', { 
    repo: 'myorg/myrepo',
    state: 'open' 
  })
  
  // 2. Save to file
  await fs.callTool('write_file', {
    path: '/workspace/issues.json',
    content: JSON.stringify(issues, null, 2)
  })
  
  // 3. Send notification to Slack
  await slack.callTool('send_message', {
    channel: '#dev',
    text: \`Found \${issues.length} open issues\`
  })
  
  return { success: true, processed: issues.length }
}
\`\`\`

**Discovery Tools (use BEFORE code execution):**
- \`list_mcp_servers\` - See all connected MCP servers
- \`get_tools\` - Get tool details from a specific server

---

`
      }

      if (showAll || t === 'packages') {
        guide += `## 📦 Package Management

**NPM Packages:**
\`\`\`typescript
import axios from 'npm:axios@^1.6.0'
import lodash from 'npm:lodash@^4.17.21'
import yaml from 'npm:yaml@^2.3.4'

const response = await axios.get('https://api.example.com')
const sorted = lodash.sortBy(data, 'name')
const config = yaml.parse(yamlString)
\`\`\`

**JSR Packages (Deno-native):**
\`\`\`typescript
import { serve } from 'jsr:@std/http'
import { assertEquals } from 'jsr:@std/assert'
import { parse } from 'jsr:@std/csv'
\`\`\`

**Pro Tip - Pre-cache Dependencies:**
Create \`deno.json\` in workspace:
\`\`\`json
{
  "imports": {
    "axios": "npm:axios@^1.6.0",
    "lodash": "npm:lodash@^4.17.21"
  }
}
\`\`\`

Server will auto-cache these on startup = faster execution!

---

`
      }

      if (showAll || t === 'examples' || t === 'patterns') {
        guide += `## 🎯 Complete Example

Demonstrating ALL principles:

\`\`\`typescript
// Efficient, secure, flexible code using all MCP Conductor features
if (typeof mcpFactory !== 'undefined') {
  const start = performance.now()
  
  // 1. Load MCP servers (reuse across calls)
  const github = await mcpFactory.load('github')
  
  // 2. Parallel operations (3x faster than sequential)
  const [repos, trending, stargazers] = await Promise.all([
    github.callTool('search_repositories', { 
      query: 'topic:deno stars:>100' 
    }),
    github.callTool('search_repositories', { 
      query: 'deno pushed:>2024-01-01' 
    }),
    github.callTool('get_repository', { 
      owner: 'denoland', 
      repo: 'deno' 
    })
  ])
  
  // 3. Process with NPM package
  import { orderBy, take } from 'npm:lodash@^4.17.21'
  const top10 = take(orderBy(repos.items, ['stargazers_count'], ['desc']), 10)
  
  // 4. Graceful file handling (works with or without permission)
  let saved = false
  try {
    await Deno.writeTextFile(
      'deno-analysis.json',
      JSON.stringify({ top10, trending, stargazers }, null, 2)
    )
    saved = true
  } catch {
    console.log('ℹ️ File write not permitted, returning data only')
  }
  
  // 5. Return comprehensive result
  return {
    success: true,
    performance: {
      duration: \`\${(performance.now() - start).toFixed(2)}ms\`,
      parallelOperations: 3,
      tokenEfficiency: 'Combined 3 MCP calls + processing in single execution'
    },
    data: {
      totalRepos: repos.items.length,
      topRepo: top10[0].full_name,
      topStars: top10[0].stargazers_count,
      trending: trending.items.length,
      denoStars: stargazers.stargazers_count
    },
    capabilities: {
      mcpProxy: true,
      npmPackages: true,
      fileAccess: saved
    }
  }
}
\`\`\`

**Key Takeaways:**
- ⚡ Single execution with multiple operations (token efficient)
- 🚀 Parallel Promise.all for 3x speed improvement
- 🔌 MCP proxy to access GitHub server
- 📦 NPM packages (lodash) for data processing
- 🔐 Graceful handling of file permissions
- 📊 Performance monitoring built-in
- 🎯 Structured return with comprehensive metadata

---

`
      }

      guide += `## 🚀 Quick Reference

**Deno APIs:**
- Files: \`Deno.readTextFile()\`, \`Deno.writeTextFile()\`, \`Deno.readDir()\`
- HTTP: \`fetch('https://api.com/data')\`
- Commands: \`new Deno.Command('git', { args: ['status'] })\`
- Environment: \`Deno.env.get('VAR')\`
- Time: \`Temporal.Now.instant()\`, \`performance.now()\`

**MCP Proxy:**
- Check: \`typeof mcpFactory !== 'undefined'\`
- Load: \`const server = await mcpFactory.load('server-name')\`
- Call: \`await server.callTool('tool-name', { params })\`

**Best Practices Checklist:**
- ✅ Combine operations in single execution (token efficiency)
- ✅ Use Promise.all for parallel operations (performance)
- ✅ Handle permission errors gracefully (security)
- ✅ Return structured data with metadata (best practice)
- ✅ Use MCP proxy to leverage other servers (flexibility)

**Remember:** The power of MCP Conductor is in combining these capabilities to solve complex tasks efficiently in a single execution!
`

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: guide,
            },
          },
        ],
      }
    },
  )
}
