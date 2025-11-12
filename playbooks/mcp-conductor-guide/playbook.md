---
name: MCP Conductor Guide
description: Comprehensive guide for using MCP Conductor effectively. This playbook should be used when planning code execution strategies, optimizing performance, or learning about MCP Conductor capabilities, configuration, and best practices.
author: MCP Conductor Team
version: 1.0.0
tags:
  - guide
  - best-practices
  - performance
  - security
source: system
---

# MCP Conductor Usage Guide

Complete guide for using MCP Conductor effectively: capabilities, configuration, best practices, and
advanced patterns.

## What is MCP Conductor?

MCP Conductor is a secure Deno code execution server that allows LLMs to run TypeScript/JavaScript
code in a sandboxed environment with:

- 🔒 **Zero permissions by default** - Admin-controlled security
- ⚡ **Fast execution** - Fresh subprocess in <100ms
- 📚 **Playbooks system** - Reusable code utilities
- 🔌 **MCP Proxy** - Call other MCP servers from code
- 📦 **NPM/JSR packages** - Import any package
- 🌍 **Global variables** - Access to workspace, playbooks, permissions

## Core Capabilities

### 1. Secure Code Execution

All code runs in isolated Deno subprocess with permissions controlled by environment variables.

**Default Security:**

```typescript
// These work without permissions
console.log('Hello') // ✅ Always works
const data = [1, 2, 3] // ✅ In-memory operations
return { result: 'success' } // ✅ Return values

// These require permissions
await fetch('https://api.com') // ❌ Needs --allow-net
await Deno.readTextFile('file.txt') // ❌ Needs --allow-read
await Deno.writeTextFile('out.txt') // ❌ Needs --allow-write
```

**Configuration:** Set via `MCP_CONDUCTOR_RUN_ARGS` environment variable:

```json
{
  "env": {
    "MCP_CONDUCTOR_RUN_ARGS": "allow-read=/workspace;allow-write=/workspace;allow-net"
  }
}
```

Note: Use semicolon (`;`) to separate multiple permission flags.

### 2. Playbooks - Reusable Code Libraries

Import pre-built utilities instead of rewriting common code:

```typescript
// Import HTTP utilities
const { fetchJSON } = await importPlaybook('http-utilities')

// Use with automatic retries and timeout
const data = await fetchJSON('https://api.github.com/users/denoland/repos', {
  retries: 3,
  timeout: 10000,
})

// Process and return
return {
  totalRepos: data.length,
  topRepo: data[0].name,
}
```

**Available Playbooks:** Use `list_playbooks` tool to discover all available playbooks.

### 3. MCP Proxy - Multi-Server Integration

Call other MCP servers from within your code:

```typescript
if (typeof mcpFactory !== 'undefined') {
  // Load GitHub MCP server
  const github = await mcpFactory.load('github')

  // Call tools from that server
  const repos = await github.callTool('search_repositories', {
    query: 'deno language:typescript stars:>100',
  })

  // Combine with local processing
  const topRepos = repos.items
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 10)

  return { topRepos }
}
```

**Discovery:** Use `list_mcp_servers` and `get_tools` tools before writing code.

### 4. Global Variables

Auto-injected variables available in every execution:

```typescript
// Access paths
const workspace = globalThis.WORKSPACE_DIR // e.g., "/Users/you/.mcp-conductor/workspace"
const playbooks = globalThis.PLAYBOOKS_DIR // e.g., "/Users/you/.mcp-conductor/playbooks"
const root = globalThis.ROOT_DIR // e.g., "/Users/you/.mcp-conductor"

// Access current permissions
const perms = globalThis.PERMISSIONS // e.g., ["--allow-read=/workspace"]

// Import playbooks easily
const utils = await importPlaybook('playbook-name')
```

### 5. Package Imports

Import npm and JSR packages directly:

```typescript
// NPM packages
import axios from 'npm:axios@^1.6.0'
import lodash from 'npm:lodash@^4.17.21'

// JSR packages (Deno-native)
import { serve } from 'jsr:@std/http'
import { parse } from 'jsr:@std/csv'

// Use immediately
const response = await axios.get('https://api.example.com')
const sorted = lodash.sortBy(data, 'name')
```

**Note:** Without `--allow-net`, packages must be pre-cached (see Configuration section).

## Performance Best Practices

### ⚡ Rule 1: Combine Operations in Single Execution

**❌ Bad - Multiple Tool Calls:**

```typescript
// First call
await run_deno_code({ code: 'const data = await fetchData()' })
// Second call
await run_deno_code({ code: 'const processed = processData(data)' })
// Third call
await run_deno_code({ code: 'await saveData(processed)' })
```

**✅ Good - Single Execution:**

```typescript
await run_deno_code({
  code: `
    const data = await fetchData();
    const processed = processData(data);
    await saveData(processed);
    return { success: true, count: processed.length };
  `,
})
```

**Why:** Each tool call has overhead. Combining saves tokens and improves speed.

### ⚡ Rule 2: Use Parallel Operations

**❌ Bad - Sequential:**

```typescript
const repos = await github.callTool('list_repos', { org: 'denoland' })
const issues = await github.callTool('list_issues', { org: 'denoland' })
const pulls = await github.callTool('list_pulls', { org: 'denoland' })
```

**✅ Good - Parallel:**

```typescript
const [repos, issues, pulls] = await Promise.all([
  github.callTool('list_repos', { org: 'denoland' }),
  github.callTool('list_issues', { org: 'denoland' }),
  github.callTool('list_pulls', { org: 'denoland' }),
])
// 3x faster!
```

### ⚡ Rule 3: Early Termination

Stop processing when you have what you need:

```typescript
const results = []
for (const item of hugeArray) {
  if (results.length >= 10) break // Stop early
  if (matches(item)) results.push(item)
}
return results
```

### ⚡ Rule 4: Use Playbooks

Reuse code instead of rewriting:

```typescript
// ❌ Bad - Rewrite fetch logic every time
async function fetchWithRetry(url) {
  let lastError
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch(url)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

// ✅ Good - Import from playbook
const { fetchWithRetry } = await importPlaybook('http-utilities')
```

## Security Best Practices

### 🔒 Principle 1: Graceful Permission Handling

Don't assume permissions - handle denials gracefully:

```typescript
// Try to save, fall back if denied
let saved = false
try {
  await Deno.writeTextFile('output.json', JSON.stringify(data))
  saved = true
  console.log('✅ Saved to file')
} catch (error) {
  console.log('ℹ️ File write not permitted, returning data only')
}

return {
  success: true,
  data,
  saved,
}
```

### 🔒 Principle 2: Feature Detection

Check for capabilities before using them:

```typescript
// Check if MCP proxy is available
const hasMCP = typeof mcpFactory !== 'undefined'

if (hasMCP) {
  const github = await mcpFactory.load('github')
  // Use GitHub MCP server
} else {
  // Fall back to direct API calls
  const response = await fetch('https://api.github.com/...')
}
```

### 🔒 Principle 3: Input Validation

Always validate and sanitize inputs:

```typescript
function processInput(input: unknown) {
  // Validate type
  if (typeof input !== 'string') {
    throw new Error('Input must be a string')
  }

  // Validate length
  if (input.length > 10000) {
    throw new Error('Input too long')
  }

  // Sanitize
  const cleaned = input.replace(/[<>]/g, '')

  return cleaned
}
```

### 🔒 Principle 4: Error Messages

Don't leak sensitive information in errors:

```typescript
try {
  const secret = await Deno.readTextFile('/secret/api-key.txt')
} catch (error) {
  // ❌ Bad - leaks path
  throw new Error(`Failed to read ${path}: ${error.message}`)

  // ✅ Good - generic message
  throw new Error('Failed to read configuration file')
}
```

## Configuration Guide

### Environment Variables

Configure MCP Conductor via environment variables in your MCP config:

```json
{
  "mcpServers": {
    "mcp-conductor": {
      "command": "deno",
      "args": ["run", "--allow-all", "jsr:@conductor/mcp", "stdio"],
      "env": {
        "MCP_CONDUCTOR_WORKSPACE": "${userHome}/.mcp-conductor/workspace",
        "MCP_CONDUCTOR_RUN_ARGS": "allow-read=${userHome}/.mcp-conductor;allow-write=${userHome}/.mcp-conductor/workspace",
        "MCP_CONDUCTOR_DEFAULT_TIMEOUT": "30000",
        "MCP_CONDUCTOR_MAX_TIMEOUT": "300000",
        "MCP_CONDUCTOR_RETURN_MODE": "json"
      }
    }
  }
}
```

### Configuration Scenarios

**Scenario 1: Secure (No Network)**

```json
{
  "env": {
    "MCP_CONDUCTOR_RUN_ARGS": "allow-read=${userHome}/.mcp-conductor;allow-write=${userHome}/.mcp-conductor/workspace"
  }
}
```

- ✅ File access to workspace
- ❌ No network access
- ✅ Playbooks accessible
- ❌ Cannot install new packages

**Scenario 2: Development (With Network)**

```json
{
  "env": {
    "MCP_CONDUCTOR_RUN_ARGS": "allow-read=${userHome}/.mcp-conductor;allow-write=${userHome}/.mcp-conductor/workspace;allow-net"
  }
}
```

- ✅ File access to workspace
- ✅ Network access
- ✅ Can install packages on the fly
- ⚠️ Less secure - use only in trusted environments

**Scenario 3: Read-Only Execution**

```json
{
  "env": {
    "MCP_CONDUCTOR_RUN_ARGS": "allow-read=${userHome}/.mcp-conductor;allow-net"
  }
}
```

- ✅ Can read files
- ✅ Network access
- ❌ Cannot write files
- ✅ Good for data analysis without side effects

### Pre-Caching Packages

To use packages without network access, pre-cache them:

**Option 1: Using deno.json**

```bash
cd ~/.mcp-conductor/workspace
cat > deno.json << 'EOF'
{
  "imports": {
    "axios": "npm:axios@^1.6.0",
    "lodash": "npm:lodash@^4.17.21",
    "@std/path": "jsr:@std/path@^1"
  }
}
EOF
deno cache --reload deno.json
```

**Option 2: Manual caching**

```bash
cd ~/.mcp-conductor/workspace
deno cache npm:axios@^1.6.0 npm:lodash@^4.17.21 jsr:@std/path
```

## Advanced Patterns

### Pattern 1: Multi-Server Orchestration

Combine multiple MCP servers in one execution:

```typescript
if (typeof mcpFactory !== 'undefined') {
  // Load servers
  const github = await mcpFactory.load('github')
  const filesystem = await mcpFactory.load('filesystem')
  const slack = await mcpFactory.load('slack')

  // 1. Fetch data from GitHub
  const issues = await github.callTool('search_issues', {
    query: 'is:open label:bug repo:myorg/myrepo',
  })

  // 2. Save to file
  await filesystem.callTool('write_file', {
    path: '/workspace/open-bugs.json',
    content: JSON.stringify(issues, null, 2),
  })

  // 3. Notify team
  await slack.callTool('post_message', {
    channel: '#dev',
    text: `Found ${issues.items.length} open bugs. Report saved to workspace.`,
  })

  return {
    success: true,
    bugsFound: issues.items.length,
    notified: true,
  }
}
```

### Pattern 2: Streaming Large Data

Process data in chunks to avoid memory issues:

```typescript
const results = []
const CHUNK_SIZE = 100

for (let offset = 0; offset < totalCount; offset += CHUNK_SIZE) {
  const chunk = await fetchChunk(offset, CHUNK_SIZE)
  const processed = chunk.map(transform)
  results.push(...processed)

  // Optional: Save incrementally
  if (results.length % 500 === 0) {
    try {
      await Deno.writeTextFile(
        'partial-results.json',
        JSON.stringify(results),
      )
    } catch {
      // Continue if write fails
    }
  }
}

return { totalProcessed: results.length }
```

### Pattern 3: Error Recovery

Implement robust error handling with retries:

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  options = { retries: 3, delay: 1000 },
): Promise<T> {
  let lastError

  for (let i = 0; i < options.retries; i++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      console.log(`Attempt ${i + 1} failed, retrying...`)
      await new Promise((resolve) => setTimeout(resolve, options.delay))
    }
  }

  throw lastError
}

// Use it
const data = await withRetry(() => fetch('https://api.example.com'))
```

### Pattern 4: Performance Monitoring

Track execution time and resource usage:

```typescript
const metrics = {
  startTime: performance.now(),
  operations: 0,
  errors: 0,
}

try {
  // Operation 1
  const data1 = await fetchData()
  metrics.operations++

  // Operation 2
  const data2 = await processData(data1)
  metrics.operations++

  // Operation 3
  await saveData(data2)
  metrics.operations++
} catch (error) {
  metrics.errors++
  throw error
} finally {
  metrics.duration = performance.now() - metrics.startTime
  console.log('Performance:', metrics)
}

return {
  success: metrics.errors === 0,
  metrics,
}
```

## Tips and Tricks

### 💡 Tip 1: Use Temporal for Dates

Deno includes the Temporal API for modern date handling:

```typescript
const now = Temporal.Now.instant()
const birthday = Temporal.PlainDate.from('1990-05-15')
const age = Temporal.Now.plainDateISO().since(birthday).years
```

### 💡 Tip 2: Structured Returns

Always return structured data for better LLM understanding:

```typescript
// ❌ Bad
return data

// ✅ Good
return {
  success: true,
  data,
  metadata: {
    count: data.length,
    timestamp: Date.now(),
    source: 'api.example.com',
  },
}
```

### 💡 Tip 3: Console Logging

Use console.log for debugging - it's captured in output:

```typescript
console.log('Starting data fetch...')
const data = await fetchData()
console.log(`Fetched ${data.length} items`)

const processed = processData(data)
console.log(`Processed ${processed.length} items`)

return { processed }
```

### 💡 Tip 4: Type Safety

Use TypeScript types for better code quality:

```typescript
interface User {
  id: number
  name: string
  email: string
}

interface ApiResponse<T> {
  data: T[]
  total: number
  page: number
}

const response: ApiResponse<User> = await fetchJSON<ApiResponse<User>>(
  'https://api.example.com/users',
)

// TypeScript ensures type safety
const firstUser: User = response.data[0]
```

### 💡 Tip 5: Command Execution

Run shell commands with Deno.Command:

```typescript
const cmd = new Deno.Command('git', {
  args: ['log', '--oneline', '-n', '5'],
})

const { stdout, stderr, code } = await cmd.output()

if (code === 0) {
  const output = new TextDecoder().decode(stdout)
  console.log('Recent commits:', output)
}
```

## Common Pitfalls to Avoid

❌ **Multiple Tool Calls** - Combine operations in one execution ❌ **Ignoring Permissions** -
Handle permission denials gracefully ❌ **No Error Handling** - Always wrap risky operations in
try/catch ❌ **Synchronous Loops** - Use Promise.all for parallel operations ❌ **Memory Leaks** -
Process large data in chunks ❌ **Hardcoded Paths** - Use `globalThis.WORKSPACE_DIR` instead ❌
**Missing Type Annotations** - Use TypeScript types ❌ **Silent Failures** - Log errors and return
error objects

## Quick Reference Card

**Environment:**

- Workspace: `globalThis.WORKSPACE_DIR`
- Playbooks: `globalThis.PLAYBOOKS_DIR`
- Permissions: `globalThis.PERMISSIONS`

**Imports:**

- Playbook: `await importPlaybook('name')`
- NPM: `import pkg from 'npm:package@version'`
- JSR: `import { fn } from 'jsr:@scope/package'`

**MCP Proxy:**

- Check: `typeof mcpFactory !== 'undefined'`
- Load: `await mcpFactory.load('server')`
- Call: `await server.callTool('tool', params)`

**Performance:**

- Combine operations in single execution
- Use `Promise.all()` for parallel operations
- Break early from loops when possible
- Import from playbooks instead of rewriting

**Security:**

- Handle permission denials gracefully
- Validate all inputs
- Don't leak sensitive info in errors
- Use try/catch for risky operations

**Best Practices:**

- Return structured objects
- Log progress with console.log
- Use TypeScript types
- Monitor performance
- Test with real data

## Summary

MCP Conductor is powerful when you:

1. **Combine operations** - One execution instead of many
2. **Use playbooks** - Reuse code instead of rewriting
3. **Go parallel** - Promise.all for concurrent operations
4. **Handle errors gracefully** - Don't assume permissions
5. **Return structured data** - Make results easy to understand

Master these principles and you'll write efficient, robust, maintainable code!
