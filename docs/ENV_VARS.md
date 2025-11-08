# Environment Variables Configuration

MCP Conductor is **secure by default** with zero permissions. You can customize the behavior using
environment variables to set defaults that match your security requirements.

## Philosophy: Secure by Default

- **Default behavior**: Zero permissions (most secure)
- **User customization**: Environment variables let you set defaults
- **Tool override**: User-specified permissions in tool calls override env var defaults

## Available Environment Variables

### `MCP_CONDUCTOR_WORKSPACE`

**Purpose**: Set the workspace directory path where code can read/write files.

**Default**: `${CWD}/.mcp-conductor/sessions` (relative to current directory)

**Examples**:

```bash
# User home directory
MCP_CONDUCTOR_WORKSPACE="${HOME}/.mcp-conductor/sessions"

# Windows
MCP_CONDUCTOR_WORKSPACE="${USERPROFILE}\.mcp-conductor\sessions"

# Temporary directory
MCP_CONDUCTOR_WORKSPACE="/tmp/mcp-sessions"

# Project-specific
MCP_CONDUCTOR_WORKSPACE="./workspace"
```

---

### `MCP_CONDUCTOR_ALLOWED_PACKAGES`

**Purpose**: Control which NPM/JSR packages can be installed.

**Default**: Curated list of ~20 common packages (see `src/executor/allowlist.ts`)

**Format**: Comma-separated list of package specifiers

**Examples**:

```bash
# Allow only specific packages (most secure)
MCP_CONDUCTOR_ALLOWED_PACKAGES="npm:axios@^1,jsr:@std/path"

# Allow more packages for development
MCP_CONDUCTOR_ALLOWED_PACKAGES="npm:axios@^1,npm:zod@^3,npm:lodash@^4,jsr:@std/path,jsr:@std/fs"

# Allow all packages (⚠️  NOT RECOMMENDED for production)
MCP_CONDUCTOR_ALLOWED_PACKAGES="all"
```

**Security Note**: Always pin versions or use strict semver ranges (e.g., `npm:axios@^1` not
`npm:axios@*`)

---

### `MCP_CONDUCTOR_RUN_ARGS`

**Purpose**: Set DEFAULT Deno permissions when no permissions specified in tool call.

**Default**: None (zero permissions - most secure)

**Format**: Comma-separated Deno flags (without `--` prefix)

**Examples**:

```bash
# Minimal (zero permissions except no-prompt)
MCP_CONDUCTOR_RUN_ARGS="no-prompt"

# Allow reading workspace by default
MCP_CONDUCTOR_RUN_ARGS="no-prompt,allow-read=${HOME}/.mcp-conductor/sessions"

# Allow workspace read/write
MCP_CONDUCTOR_RUN_ARGS="no-prompt,allow-read=${HOME}/.mcp-conductor/sessions,allow-write=${HOME}/.mcp-conductor/sessions"

# Allow specific network access
MCP_CONDUCTOR_RUN_ARGS="no-prompt,allow-net=api.github.com"

# Multiple permissions
MCP_CONDUCTOR_RUN_ARGS="no-prompt,allow-read=/workspace,allow-write=/workspace,allow-net=api.github.com"
```

**Important**: These are DEFAULTS used when the user doesn't specify permissions. If the user
specifies permissions in the tool call, these are OVERRIDDEN (not merged).

---

### `MCP_CONDUCTOR_DEFAULT_TIMEOUT`

**Purpose**: Set default execution timeout in milliseconds.

**Default**: `30000` (30 seconds)

**Examples**:

```bash
# 10 seconds
MCP_CONDUCTOR_DEFAULT_TIMEOUT="10000"

# 1 minute
MCP_CONDUCTOR_DEFAULT_TIMEOUT="60000"
```

---

### `MCP_CONDUCTOR_MAX_TIMEOUT`

**Purpose**: Set maximum allowed timeout in milliseconds.

**Default**: `300000` (5 minutes)

**Examples**:

```bash
# 30 seconds max
MCP_CONDUCTOR_MAX_TIMEOUT="30000"

# 10 minutes max
MCP_CONDUCTOR_MAX_TIMEOUT="600000"
```

---

## Configuration Examples

### 1. Maximum Security (Production)

```json
{
  "mcpServers": {
    "mcp-conductor": {
      "command": "deno",
      "args": [
        "run",
        "--no-prompt",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run=deno",
        "src/cli/cli.ts",
        "stdio"
      ],
      "env": {
        "MCP_CONDUCTOR_WORKSPACE": "${userHome}/.mcp-conductor/sessions",
        "MCP_CONDUCTOR_ALLOWED_PACKAGES": "npm:axios@^1,npm:zod@^3,jsr:@std/path",
        "MCP_CONDUCTOR_RUN_ARGS": "no-prompt",
        "MCP_CONDUCTOR_DEFAULT_TIMEOUT": "10000",
        "MCP_CONDUCTOR_MAX_TIMEOUT": "30000"
      }
    }
  }
}
```

**Security Level**: 🔒🔒🔒 Maximum

- Zero default permissions
- Strict package allowlist (3 packages)
- Short timeouts
- User must explicitly request permissions

---

### 2. Balanced (Development)

```json
{
  "mcpServers": {
    "mcp-conductor": {
      "command": "deno",
      "args": [
        "run",
        "--no-prompt",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run=deno",
        "src/cli/cli.ts",
        "stdio"
      ],
      "env": {
        "MCP_CONDUCTOR_WORKSPACE": "${userHome}/.mcp-conductor/sessions",
        "MCP_CONDUCTOR_ALLOWED_PACKAGES": "npm:axios@^1,npm:zod@^3,npm:lodash@^4,jsr:@std/path,jsr:@std/fs,jsr:@std/collections",
        "MCP_CONDUCTOR_RUN_ARGS": "no-prompt,allow-read=${userHome}/.mcp-conductor/sessions,allow-write=${userHome}/.mcp-conductor/sessions",
        "MCP_CONDUCTOR_DEFAULT_TIMEOUT": "30000",
        "MCP_CONDUCTOR_MAX_TIMEOUT": "60000"
      }
    }
  }
}
```

**Security Level**: 🔒🔒 Balanced

- Default workspace access
- Moderate package allowlist (~6 packages)
- Standard timeouts
- Network still requires explicit permission

---

### 3. Permissive (Local Development Only)

```json
{
  "mcpServers": {
    "mcp-conductor": {
      "command": "deno",
      "args": [
        "run",
        "--no-prompt",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run=deno",
        "src/cli/cli.ts",
        "stdio"
      ],
      "env": {
        "MCP_CONDUCTOR_WORKSPACE": "/tmp/mcp-sessions",
        "MCP_CONDUCTOR_ALLOWED_PACKAGES": "all",
        "MCP_CONDUCTOR_RUN_ARGS": "no-prompt,allow-read=/tmp/mcp-sessions,allow-write=/tmp/mcp-sessions,allow-net",
        "MCP_CONDUCTOR_DEFAULT_TIMEOUT": "60000",
        "MCP_CONDUCTOR_MAX_TIMEOUT": "300000"
      }
    }
  }
}
```

**Security Level**: ⚠️ Permissive (USE WITH CAUTION)

- Default workspace + network access
- All packages allowed
- Long timeouts
- ⚠️ NOT recommended for production or untrusted code

---

## How Permissions Work

### Permission Priority (Override Logic)

```
User Tool Call Permissions > Default Run Args > Zero Permissions
```

**Example 1: User specifies permissions**

```typescript
// Tool call with explicit permissions
{
  permissions: {
    net: ;
    ;['api.github.com']
  }
}

// Result: Uses ONLY { net: ['api.github.com'] }
// Default run args are IGNORED
```

**Example 2: No user permissions**

```typescript
// Tool call without permissions
{}

// With MCP_CONDUCTOR_RUN_ARGS="no-prompt,allow-read=/workspace"
// Result: Uses ['--no-prompt', '--allow-read=/workspace']

// Without MCP_CONDUCTOR_RUN_ARGS
// Result: Uses [] (zero permissions)
```

---

## Security Best Practices

### ✅ DO

- Start with zero or minimal default permissions
- Use specific package versions (e.g., `npm:axios@1.6.0`)
- Pin semver ranges (e.g., `npm:axios@^1` not `npm:axios@*`)
- Use workspace isolation for file operations
- Set reasonable timeouts
- Whitelist specific network domains
- Review and audit allowed packages regularly

### ❌ DON'T

- Set `MCP_CONDUCTOR_ALLOWED_PACKAGES="all"` in production
- Use wildcard package versions (e.g., `npm:axios@*`)
- Grant broad file system access (e.g., `allow-read=true`)
- Grant broad network access (e.g., `allow-net=true`)
- Set very long timeouts (DoS risk)
- Trust unaudited dependencies

---

## Testing Your Configuration

After setting environment variables, test with:

```bash
# Start the server with your config
deno run --allow-all src/cli/cli.ts stdio

# You should see output like:
# === MCP Conductor Configuration ===
# Workspace: /home/user/.mcp-conductor/sessions
# Allowed packages: 4 packages
#   - npm:axios@^1
#   - npm:zod@^3
#   - jsr:@std/path
#   - jsr:@std/fs
# Default run args: --no-prompt
# ===================================
# 🔒 Default permissions: NONE (zero permissions - most secure)
```

---

## Environment Variable Loading

MCP Conductor loads configuration in this order:

1. **Environment variables** (from shell, `.cursor/mcp.json`, etc.)
2. **Runtime config** (passed to `createServer()`)
3. **Hardcoded defaults** (secure fallbacks)

Later sources override earlier ones, so runtime config takes precedence over env vars.

---

## See Also

- [Security Best Practices](./SECURITY.md)
- [Configuration Guide](./CONFIGURATION.md)
- [Quickstart Guide](./QUICKSTART.md)
