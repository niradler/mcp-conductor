# MCP Conductor 🎼

**Secure Deno code execution for AI agents via Model Context Protocol**

> Execute TypeScript/JavaScript code in isolated, permission-controlled sandboxes

[![JSR](https://jsr.io/badges/@conductor/mcp)](https://jsr.io/@conductor/mcp)
[![JSR Score](https://jsr.io/badges/@conductor/mcp/score)](https://jsr.io/@conductor/mcp)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Deno](https://img.shields.io/badge/deno-2.x-green.svg)](https://deno.land)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)](https://www.typescriptlang.org/)

---

## Overview

**MCP Conductor** is a Model Context Protocol (MCP) server that provides secure, sandboxed execution
of TypeScript and JavaScript code for AI agents. Built on Deno's security-first runtime, it enables
LLMs to run code with fine-grained permission control configured entirely by administrators via
environment variables.

**Zero Installation**: Available on [JSR](https://jsr.io/@conductor/mcp) - no installation required, just add to your MCP configuration and go!

### Key Features

- 🔒 **Security First**: Deno's permission model with zero permissions by default
- 🎛️ **Admin-Controlled**: Permissions configured via environment variables, not by the LLM
- ⚡ **Fast & Simple**: Fresh subprocess per execution with <100ms startup
- 🚫 **No Escalation**: LLMs cannot request additional permissions
- 📁 **Workspace Isolation**: Code executes in workspace directory with deno.json support
- 📦 **Standard Deno**: Uses Deno's natural caching - no custom dependency management
- 🔌 **MCP Proxy**: Connect to multiple MCP servers and call their tools from within executed code

---

## Quick Start

### 1. Installation

**Option A: Direct from JSR (Recommended)**

No installation required! MCP Conductor is available on the JSR registry and can be used directly in your MCP configuration:

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
        "jsr:@conductor/mcp",
        "stdio"
      ]
    }
  }
}
```

Deno will automatically download and cache the package on first run.

**Version Pinning (Recommended for Production)**:

Pin to a specific version for stability:

```json
"jsr:@conductor/mcp@0.1.1"
```

Or use semver ranges:

```json
"jsr:@conductor/mcp@^0.1"
```

**Option B: Development (Clone Repository)**

For local development or contributing:

```bash
git clone https://github.com/niradler/mcp-conductor
cd mcp-conductor
# Use "src/cli/cli.ts" instead of "jsr:@conductor/mcp" in your config
```

**Option C: Docker (Production Deployments)**

For containerized deployments with full isolation:

```bash
# Build the image
docker build -t mcp-conductor:latest .

# Run with stdio transport
docker run --rm -i \
  -v $(pwd)/workspace:/workspace \
  mcp-conductor:latest stdio

# Run with HTTP transport
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/workspace:/workspace \
  mcp-conductor:latest http

# Or use docker-compose
docker-compose up -d mcp-conductor
```

See the [Docker section](#docker-deployment) below for detailed configuration options, or check out the comprehensive [Docker Deployment Guide](examples/DOCKER.md) for advanced scenarios.

### 2. Configure in Cursor/Claude Desktop

**Basic Configuration (Secure - No Network)**:

Add to `.cursor/mcp.json` or Claude Desktop config:

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
        "jsr:@conductor/mcp",
        "stdio"
      ],
      "env": {
        "MCP_CONDUCTOR_WORKSPACE": "${userHome}/.mcp-conductor/workspace",
        "MCP_CONDUCTOR_RUN_ARGS": "allow-read=${userHome}/.mcp-conductor/workspace,allow-write=${userHome}/.mcp-conductor/workspace"
      }
    }
  }
}
```

**For Claude Desktop**:

Add the same configuration to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

**For Local Development** (use source instead of JSR):

Replace `"jsr:@conductor/mcp"` with `"src/cli/cli.ts"` in the args array above.

**Note:** By default, `--cached-only` and `--no-remote` are added automatically for security. User
code can only import pre-cached packages.

**With Network Access (Less Secure - User Must Explicitly Enable)**:

```json
{
  "env": {
    "MCP_CONDUCTOR_WORKSPACE": "${userHome}/.mcp-conductor/workspace",
    "MCP_CONDUCTOR_RUN_ARGS": "allow-read=${userHome}/.mcp-conductor/workspace,allow-write=${userHome}/.mcp-conductor/workspace,allow-net"
  }
}
```

**Note**: With `--allow-net`, the LLM can import any npm/jsr package dynamically.

### 3. Restart Your IDE

Restart Cursor/Claude Desktop to load the MCP server.

### 4. Use the Tool

The LLM can now execute code with the configured permissions:

```typescript
// LLM can write code that accesses the workspace
const data = await Deno.readTextFile("/path/to/workspace/file.txt");
const processed = data.toUpperCase();
await Deno.writeTextFile("/path/to/workspace/output.txt", processed);
processed;
```

**Note**: The LLM cannot specify permissions - they're controlled by your environment variables!

---

## Security Model

MCP Conductor uses a **zero-trust, two-process security model**:

### Default Security Flags

All user code runs with these security flags by default:

- `--no-prompt` - Prevents interactive permission prompts
- `--cached-only` - Only uses cached dependencies (no network fetching)
- `--no-remote` - Blocks remote module fetching
- **Zero permissions** - No file, network, environment, or subprocess access

### Two-Process Isolation

```
Server Process (Trusted)
├── Full permissions to manage workspace
├── Install dependencies
└── Spawn sandboxed subprocesses

User Code Subprocess (Untrusted)
├── Zero permissions by default
├── Cannot access server permissions
├── Crashes don't affect server
└── Fresh environment per execution
```

### Security Best Practices

1. **Production**: Use minimal permissions

   ```json
   {
     "env": {
       "MCP_CONDUCTOR_RUN_ARGS": "allow-read=/workspace,allow-write=/workspace"
     }
   }
   ```

2. **Development**: Grant network access if needed

   ```json
   {
     "env": {
       "MCP_CONDUCTOR_RUN_ARGS": "allow-read=/workspace,allow-write=/workspace,allow-net"
     }
   }
   ```

3. **Never use** `--allow-all` in production

### Code Execution is Unrestricted by Design

Per [Deno's security documentation](https://docs.deno.com/runtime/fundamentals/security/):

> "No limits on the execution of code at the same privilege level"

These features are **allowed by design**:

- `eval()` and `Function()` constructor
- data: URLs (e.g., `import('data:text/javascript,...')`)
- Dynamic imports and Workers
- WebAssembly

**The security boundary is the PERMISSION SANDBOX**, not code execution:

- All code runs at zero permissions by default
- Cannot access files, network, env vars, or spawn processes
- Each execution isolated in fresh subprocess
- Crashes don't affect server process

This aligns with Deno's philosophy: trust the permission system, not code restrictions.

---

## Using Packages Without Network Access 📦

To use npm/jsr packages without granting `--allow-net`, pre-cache them in your workspace:

### Option 1: Using workspace deno.json

Create `~/.mcp-conductor/workspace/deno.json`:

```json
{
  "imports": {
    "axios": "npm:axios@^1.6.0",
    "zod": "npm:zod@^3.23.0",
    "@std/path": "jsr:@std/path@^1"
  }
}
```

Then pre-cache the packages:

```bash
cd ~/.mcp-conductor/workspace
deno cache --reload deno.json
```

Now LLM code can import them without network access:

```typescript
import axios from "axios";
import { z } from "zod";
import { join } from "@std/path";

const response = await axios.get("https://api.example.com"); // ❌ Fails (no --allow-net)
// But imports work! ✅ (pre-cached)
```

### Option 2: Manual Pre-caching

```bash
cd ~/.mcp-conductor/workspace
deno cache npm:axios@^1.6.0 npm:zod@^3.23.0 jsr:@std/path
```

**Security Note**: Deno's cache is global (`~/.cache/deno`). Once cached, packages can be imported
without network access. The real security boundary is the **permission sandbox** (--allow-read,
--allow-net, etc.), not package lists. Per
[Deno's security model](https://docs.deno.com/runtime/fundamentals/security/), eval(), Function(),
and dynamic imports are allowed by design.

---

## MCP Proxy: Access Multiple MCP Servers from Code 🔌

MCP Conductor can act as a proxy to connect to multiple MCP servers, allowing your executed code to
interact with various MCP tools seamlessly. This enables powerful multi-system workflows within a
single code execution.

### How It Works

1. **Configure MCP Servers**: Create a `mcp-config.json` file listing the MCP servers you want to
   connect to
2. **Auto-Injected `mcpFactory`**: A global `mcpFactory` object is automatically available in your
   code
3. **Load & Call Tools**: Use `mcpFactory.load(serverName)` to access any configured MCP server's
   tools

### Setting Up MCP Proxy

Create `~/.mcp-conductor/mcp-config.json` (or set via `MCP_CONDUCTOR_MCP_CONFIG` env var):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/allowed/directory"
      ]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"
      }
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

### Example: Using Multiple MCP Servers

```typescript
// The LLM can write code that uses multiple MCP servers:

// List available MCP servers
const servers = await mcpFactory.listServers();
console.log("Available servers:", servers);

// Load the GitHub MCP server
const github = await mcpFactory.load("github");

// Call tools from the GitHub server
const repos = await github.callTool("list_repos", {
  username: "octocat",
});
console.log("Found repositories:", repos);

// Load the filesystem server
const fs = await mcpFactory.load("filesystem");

// Save the results
await fs.callTool("write_file", {
  path: "/allowed/directory/repos.json",
  content: JSON.stringify(repos, null, 2),
});

("Multi-server workflow complete!");
```

### Available MCP Proxy Tools

MCP Conductor also exposes these tools for discovering available MCP servers:

- **`list_mcp_servers`**: List all configured MCP servers and their status
- **`get_tools`**: Get detailed information about tools from a specific MCP server

### Example: Query Before Using

```typescript
// First, discover what servers are available
// (using the list_mcp_servers tool, separate from code execution)

// Then write code that uses those servers
const github = await mcpFactory.load("github");
const tools = await github.listTools();
console.log(`GitHub server has ${tools.length} tools available`);

// Use a specific tool
const issues = await github.callTool("search_issues", {
  query: "is:open label:bug",
  repo: "myorg/myrepo",
});
`Found ${issues.length} open bugs`;
```

### Security Considerations

- MCP servers run as **separate processes** with their own permissions
- The code execution sandbox still follows all normal security restrictions
- Set `--allow-run` permission to allow spawning MCP server processes
- Configure allowed binaries carefully (e.g., `--allow-run=node,npx,deno`)
- MCP server environment variables (like API tokens) are isolated from your code

---

## Configuration

### Environment Variables

Configure MCP Conductor's behavior via environment variables in your MCP config:

| Variable                         | Purpose                  | Example                                        |
| -------------------------------- | ------------------------ | ---------------------------------------------- |
| `MCP_CONDUCTOR_WORKSPACE`        | Workspace directory path | `${userHome}/.mcp-conductor/workspace`         |
| `MCP_CONDUCTOR_ALLOWED_PACKAGES` | Allowed NPM/JSR packages | `npm:axios@^1,jsr:@std/path`                   |
| `MCP_CONDUCTOR_RUN_ARGS`         | Default Deno permissions | `allow-read=/workspace,allow-write=/workspace` |
| `MCP_CONDUCTOR_DEFAULT_TIMEOUT`  | Default timeout (ms)     | `30000`                                        |
| `MCP_CONDUCTOR_MAX_TIMEOUT`      | Maximum timeout (ms)     | `300000`                                       |
| `MCP_CONDUCTOR_MCP_CONFIG`       | Path to MCP proxy config | `${userHome}/.mcp-conductor/mcp-config.json`   |

See [docs/ENV_VARS.md](docs/ENV_VARS.md) for detailed configuration guide.

### Example Configurations

- [Cursor IDE Example](examples/cursor-mcp-example.json) - Shows both JSR and local development setups
- [Claude Desktop Example](examples/claude-desktop-example.json) - Production-ready configuration
- [MCP Proxy Config](examples/mcp-config-example.json) - How to configure other MCP servers
- [Docker MCP Config](examples/docker-mcp-config.json) - Using Docker containers with MCP

---

## Docker Deployment

MCP Conductor can be deployed as a Docker container for production environments, providing complete isolation and consistent deployments.

### Building the Image

```bash
# Clone the repository
git clone https://github.com/niradler/mcp-conductor
cd mcp-conductor

# Build the Docker image
docker build -t mcp-conductor:latest .
```

### Running with Docker

**Stdio Transport (for MCP clients)**:

```bash
docker run --rm -i \
  -v $HOME/.mcp-conductor/workspace:/workspace \
  -e MCP_CONDUCTOR_RUN_ARGS="allow-read=/workspace,allow-write=/workspace" \
  mcp-conductor:latest stdio
```

**HTTP Transport (for REST API access)**:

```bash
docker run -d \
  --name mcp-conductor \
  -p 3000:3000 \
  -v $HOME/.mcp-conductor/workspace:/workspace \
  -e MCP_CONDUCTOR_RUN_ARGS="allow-read=/workspace,allow-write=/workspace,allow-net" \
  mcp-conductor:latest http
```

### Using Docker Compose

The repository includes a `docker-compose.yml` with three pre-configured services:

**1. Basic (stdio, no network)**:

```bash
docker-compose up -d mcp-conductor
```

**2. With Network Access**:

```bash
docker-compose up -d mcp-conductor-network
```

**3. HTTP Server**:

```bash
docker-compose up -d mcp-conductor-http
```

### Docker Environment Variables

All standard environment variables work in Docker:

```bash
docker run --rm -i \
  -v $(pwd)/workspace:/workspace \
  -e MCP_CONDUCTOR_WORKSPACE=/workspace \
  -e MCP_CONDUCTOR_RUN_ARGS="allow-read=/workspace,allow-write=/workspace" \
  -e MCP_CONDUCTOR_DEFAULT_TIMEOUT=60000 \
  -e MCP_CONDUCTOR_MAX_TIMEOUT=300000 \
  mcp-conductor:latest stdio
```

### MCP Client Configuration with Docker

**Cursor/Claude Desktop** (`.cursor/mcp.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mcp-conductor-docker": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-v",
        "${userHome}/.mcp-conductor/workspace:/workspace",
        "mcp-conductor:latest",
        "stdio"
      ],
      "env": {
        "MCP_CONDUCTOR_WORKSPACE": "/workspace",
        "MCP_CONDUCTOR_RUN_ARGS": "allow-read=/workspace,allow-write=/workspace"
      }
    }
  }
}
```

**HTTP Transport**:

```json
{
  "mcpServers": {
    "mcp-conductor-http": {
      "url": "http://localhost:3000",
      "transport": "http"
    }
  }
}
```

### Docker Security Considerations

1. **Volume Mounts**: Only mount necessary directories

   ```bash
   -v $(pwd)/workspace:/workspace  # ✅ Specific directory
   -v /:/host                      # ❌ NEVER do this
   ```

2. **Resource Limits**: Set memory and CPU limits

   ```bash
   docker run --memory="512m" --cpus="1.0" mcp-conductor:latest
   ```

3. **Network Isolation**: Use Docker networks for service isolation

   ```bash
   docker network create mcp-network
   docker run --network mcp-network mcp-conductor:latest
   ```

4. **Read-only Root Filesystem** (advanced):
   ```bash
   docker run --read-only --tmpfs /tmp mcp-conductor:latest
   ```

### Docker Multi-Stage Build (Coming Soon)

For smaller production images, we'll add multi-stage builds in future releases:

```dockerfile
# Future optimization - reduces image size by ~50%
FROM denoland/deno:alpine AS builder
# ... build steps ...
FROM denoland/deno:alpine
COPY --from=builder /app /app
```

### Kubernetes Deployment (Advanced)

Example Kubernetes deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-conductor
spec:
  replicas: 2
  selector:
    matchLabels:
      app: mcp-conductor
  template:
    metadata:
      labels:
        app: mcp-conductor
    spec:
      containers:
        - name: mcp-conductor
          image: mcp-conductor:latest
          ports:
            - containerPort: 3000
          env:
            - name: MCP_CONDUCTOR_WORKSPACE
              value: /workspace
            - name: MCP_CONDUCTOR_RUN_ARGS
              value: allow-read=/workspace,allow-write=/workspace,allow-net
          volumeMounts:
            - name: workspace
              mountPath: /workspace
          resources:
            limits:
              memory: "512Mi"
              cpu: "1000m"
            requests:
              memory: "256Mi"
              cpu: "500m"
      volumes:
        - name: workspace
          persistentVolumeClaim:
            claimName: mcp-workspace-pvc
```

### Troubleshooting Docker

**Container exits immediately**:

```bash
# Check logs
docker logs mcp-conductor

# Run interactively to see errors
docker run --rm -it mcp-conductor:latest stdio
```

**Permission denied errors**:

```bash
# Ensure workspace directory exists and has proper permissions
mkdir -p $HOME/.mcp-conductor/workspace
chmod 755 $HOME/.mcp-conductor/workspace
```

**Cannot connect to HTTP server**:

```bash
# Check if container is running
docker ps | grep mcp-conductor

# Test health endpoint
curl http://localhost:3000/health
```

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│      LLM Agent (Claude Desktop, Cursor, etc.)        │
│      • Writes TypeScript/JavaScript code             │
│      • Requests code execution via MCP               │
└──────────────────────┬───────────────────────────────┘
                       │ MCP Protocol (stdio/HTTP)
┌──────────────────────▼───────────────────────────────┐
│              MCP Conductor Server                    │
│  ┌────────────────────────────────────────────────┐  │
│  │  run_deno_code Tool                            │  │
│  │  • Validates dependencies against allowlist    │  │
│  │  • Injects mcpFactory for proxy access         │  │
│  │  • Spawns isolated Deno subprocess             │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │  MCP Proxy Manager (Optional)                  │  │
│  │  • Connects to configured MCP servers          │  │
│  │  • Manages client connections                  │  │
│  │  • Provides RPC server for code access         │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │  MCP Proxy Tools                               │  │
│  │  • list_mcp_servers - Discover available MCP   │  │
│  │  • get_tools - Get MCP server tool info │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │ Spawns      │ Connects to │
         ▼             ▼             ▼
┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│Deno Process │  │   MCP    │  │   MCP    │  │   MCP    │
│  (Sandbox)  │  │  Server  │  │  Server  │  │  Server  │
│             │  │ (GitHub) │  │  (Slack) │  │ (Memory) │
│• User Code  │  └──────────┘  └──────────┘  └──────────┘
│• mcpFactory │       ▲             ▲             ▲
│  calls      │       │             │             │
│• Zero perms │       └─────────────┴─────────────┘
│  by default │         RPC calls via mcpFactory
└─────────────┘
```

### How It Works

1. **LLM writes code** using the `run_deno_code` tool
2. **MCP Conductor validates** dependencies and prepares execution environment
3. **Code runs in sandbox** - fresh Deno subprocess with admin-controlled permissions
4. **Optional MCP Proxy** - code can access other MCP servers via `mcpFactory` global
5. **Results returned** - stdout, stderr, return value, and any errors

---

## Use Cases

### 1. Secure Code Execution

Execute LLM-generated code with fine-grained security controls, perfect for AI agents that need to
process data or perform calculations.

```typescript
// LLM writes code, admin controls permissions
const data = await Deno.readTextFile("./workspace/data.csv");
const processed = data.split("\n").map((line) => line.toUpperCase());
processed.join("\n");
```

### 2. Multi-System Integration via MCP Proxy

Connect to multiple MCP servers and orchestrate complex workflows across systems:

```typescript
// Query GitHub for issues
const github = await mcpFactory.load("github");
const issues = await github.callTool("list_issues", {
  repo: "myorg/myrepo",
  state: "open",
});

// Save to filesystem
const fs = await mcpFactory.load("filesystem");
await fs.callTool("write_file", {
  path: "./workspace/issues.json",
  content: JSON.stringify(issues, null, 2),
});

// Send summary to Slack
const slack = await mcpFactory.load("slack");
await slack.callTool("post_message", {
  channel: "#updates",
  text: `Found ${issues.length} open issues`,
});

("Workflow complete!");
```

### 3. Data Processing with External APIs

Fetch data, process it, and integrate with other services:

```typescript
// Fetch from external API (if --allow-net permission granted)
const response = await fetch("https://api.example.com/data");
const data = await response.json();

// Process with TypeScript
const summary = data.items
  .filter((item) => item.status === "active")
  .reduce((acc, item) => acc + item.value, 0);

// Store in workspace
await Deno.writeTextFile("./workspace/summary.txt", `Total: ${summary}`);

summary;
```

---

## Performance

### Execution Speed

| Operation               | Time      |
| ----------------------- | --------- |
| Deno sandbox startup    | 50-100ms  |
| TypeScript execution    | 100-300ms |
| MCP proxy tool call     | 50-200ms  |
| Parallel MCP calls (3x) | ~200ms    |

### Resource Usage

| Component                 | Memory     |
| ------------------------- | ---------- |
| MCP Conductor server      | ~10 MB     |
| Per code execution        | ~20 MB     |
| Per MCP connection        | ~4 MB      |
| **Total (3 MCP servers)** | **~42 MB** |

---

## Available Tools

MCP Conductor provides the following MCP tools:

### 1. `run_deno_code`

Execute TypeScript/JavaScript code in a secure Deno sandbox.

**Parameters:**

- `deno_code` (required): TypeScript or JavaScript code to execute
- `timeout` (optional): Execution timeout in milliseconds (default: 30000, max: 300000)
- `globals` (optional): Global variables to inject into execution context
- `dependencies` (optional): NPM or JSR dependencies to install (must be in allowlist)

**Features:**

- Full TypeScript and modern JavaScript support
- Async/await support
- Return value capture from last expression
- stdout/stderr capture
- Admin-controlled permissions
- Auto-injected `mcpFactory` for MCP proxy access (if enabled)

### 2. `list_mcp_servers` (if MCP proxy enabled)

List all configured MCP servers and their status.

**Returns:**

- Array of server info including name, status, available tools/resources/prompts count

### 3. `get_tools` (if MCP proxy enabled)

Get detailed information about tools from a specific MCP server.

**Parameters:**

- `server` (required): Name of the MCP server
- `tools` (optional): Specific tool names to get details for (returns all if not specified)

**Returns:**

- Detailed tool specifications including parameters, descriptions, and schemas

---

## Documentation

- 📄 [Environment Variables](docs/ENV_VARS.md) - Detailed configuration guide
- 🔒 [Security Model](docs/SECURITY.md) - Security architecture and best practices
- 🐳 [Docker Deployment Guide](examples/DOCKER.md) - Comprehensive Docker deployment scenarios
- 💡 [Examples](examples/) - Code examples for common patterns

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

**Areas where we need help:**

- Additional MCP server testing and examples
- Documentation improvements
- Performance benchmarking
- Security audits
- Example workflows

---

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Anthropic](https://anthropic.com) - For creating the Model Context Protocol
- [Deno Team](https://deno.land) - For the secure-by-default runtime
- [MCP Community](https://modelcontextprotocol.io) - For building the MCP ecosystem
- [@pydantic/mcp-run-python](https://github.com/pydantic/mcp-run-python) - For security model
  inspiration

---

## Security

MCP Conductor is designed with security as a first-class concern. Understanding the security model
is crucial for safe deployment.

### Two-Process Security Architecture

**Critical Understanding**: Conductor uses **two separate Deno processes** with different permission
levels:

```
┌─────────────────────────────────────────────────────────────┐
│  MCP Server Process (Privileged - Trusted Code)            │
│  Permissions: --allow-read, --allow-write, --allow-net     │
│              --allow-env, --allow-run=deno                  │
│                                                              │
│  Purpose: Manage workspace, install deps, spawn subprocesses│
│  ────────────────────────────────────────────────────────── │
│  │                                                           │
│  │ spawns ↓                                                 │
│  │                                                           │
│  │  ┌───────────────────────────────────────────────────┐  │
│  │  │ User Code Subprocess (Sandboxed - Untrusted)     │  │
│  │  │ Permissions: ZERO by default + only requested    │  │
│  │  │                                                    │  │
│  │  │ Purpose: Execute LLM-generated code               │  │
│  │  │ Example: --no-prompt --allow-net=api.github.com  │  │
│  │  │                                                    │  │
│  │  │ ❌ NO access to server's --allow-write           │  │
│  │  │ ❌ NO access to server's --allow-env             │  │
│  │  │ ❌ NO access to server's full --allow-run        │  │
│  │  └───────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Point**: User code runs in a **separate subprocess** and does NOT inherit the server's
permissions.

### Security Model

#### 1. **Zero Permissions by Default** 🔒

All code executes in a Deno subprocess with **NO permissions** unless explicitly granted:

```typescript
// ❌ This will FAIL - no network access by default
await fetch("https://api.example.com");

// ✅ This works - permission explicitly granted
await conductor.execute(convId, code, {
  permissions: { net: ["api.example.com"] },
});
```

#### 2. **Deno Permission Model**

Deno provides fine-grained permissions that must be explicitly granted:

| Permission | Description                | Example                                                |
| ---------- | -------------------------- | ------------------------------------------------------ |
| `net`      | Network access             | `{ net: ['api.github.com'] }` - only GitHub API        |
| `read`     | File system read           | `{ read: ['/workspace'] }` - only workspace dir        |
| `write`    | File system write          | `{ write: ['/workspace/output'] }` - specific dir only |
| `env`      | Environment variables      | `{ env: ['API_KEY'] }` - specific vars only            |
| `run`      | Subprocess execution       | `{ run: ['git'] }` - specific commands only            |
| `ffi`      | Foreign function interface | Generally **never needed**                             |
| `hrtime`   | High-resolution time       | Rarely needed                                          |
| `all`      | Grant all permissions      | ⚠️ **DANGEROUS** - avoid in production                 |

#### 3. **Admin-Controlled Version Injection** 🔐

**LLMs cannot override package versions** - admins control ALL versions via allowlist:

```typescript
// LLM writes (no version specified):
dependencies:;
["npm:axios"];

// Server auto-injects (from MCP_CONDUCTOR_ALLOWED_PACKAGES):
dependencies:;
["npm:axios@^1"]; // ← Admin-controlled version
```

**Benefits**:

- ✅ LLMs don't need to memorize package versions
- ✅ Admins control security updates via environment variables
- ✅ Prevents malicious version injection (`npm:axios@^999`)
- ✅ Consistent versions across all executions

**Security Test Results** (all passed ✅):

| Attack Vector                                | Result                               |
| -------------------------------------------- | ------------------------------------ |
| Version override attempt (`npm:axios@^999`)  | ❌ Blocked - version doesn't exist   |
| String injection (`npm:axios'; import evil`) | ❌ Blocked - invalid format detected |
| Unauthorized package (`npm:express`)         | ❌ Blocked - not in allowlist        |
| System file access (`/etc/passwd`)           | ❌ Blocked - permission denied       |
| Network exfiltration (`evil.com`)            | ❌ Blocked - permission denied       |
| Infinite loop                                | ❌ Killed after timeout              |

#### 4. **No Interactive Prompts**

The `--no-prompt` flag ensures code **fails immediately** if permissions are insufficient,
preventing:

- Timeout-based denial of service
- Permission escalation attacks
- Interactive prompt injection

```typescript
// Without --no-prompt: hangs waiting for user input ❌
// With --no-prompt: fails in <100ms with clear error ✅
```

#### 5. **Two-Step Dependency Installation**

Following the [mcp-run-python security model](https://github.com/pydantic/mcp-run-python):

**Step 1**: Install dependencies with controlled write access

```typescript
// Write permission ONLY to dependency cache
// Untrusted code CANNOT run yet
await installDependencies(["npm:axios", "npm:lodash"]);
```

**Step 2**: Execute code with read-only access

```typescript
// Dependencies cached and available
// Code has NO write permissions to dependency directory
// Cannot modify or inject malicious dependencies
await runCode(userCode, { permissions: { read: ["./node_modules"] } });
```

#### 5. **Resource Limits**

Every execution has strict resource limits:

- **Timeout**: Default 30s, max 5 minutes (prevents infinite loops)
- **Memory**: Isolated V8 context (prevents memory exhaustion)
- **Process isolation**: Each execution in fresh subprocess

### Best Practices

#### ✅ **DO**

1. **Minimal Permissions** - Grant only what's needed:

   ```typescript
   // Good: specific domain
   {
     net:;
     ["api.github.com"];
   }

   // Bad: all network access
   {
     net: true;
   }
   ```

2. **Whitelist Specific Paths** - Never grant broad filesystem access:

   ```typescript
   // Good: specific workspace
   { read: ['./workspace'], write: ['./workspace/output'] }

   // Bad: entire filesystem
   { read: true, write: true }
   ```

3. **Validate User Input** - Always validate before execution:

   ```typescript
   if (code.includes("Deno.exit") || code.includes("eval(")) {
     throw new Error("Forbidden operations detected");
   }
   ```

4. **Set Reasonable Timeouts** - Match to expected execution time:

   ```typescript
   // Fast operations
   {
     timeout: 5000;
   } // 5 seconds

   // API calls
   {
     timeout: 30000;
   } // 30 seconds (default)
   ```

5. **Monitor and Log** - Track all executions:
   ```typescript
   await conductor.execute(convId, code, {
     onLog: (level, message) => {
       logger.info({ level, message, convId, timestamp: Date.now() });
     },
   });
   ```

#### ❌ **DON'T**

1. **Never Use `all: true` in Production**:

   ```typescript
   // ❌ DANGEROUS - grants all permissions
   {
     all: true;
   }
   ```

2. **Don't Trust User Code**:

   ```typescript
   // ❌ BAD - no validation
   await conductor.execute(convId, userProvidedCode);

   // ✅ GOOD - validate first
   validateCode(userProvidedCode);
   await conductor.execute(convId, userProvidedCode);
   ```

3. **Don't Grant Write to System Directories**:

   ```typescript
   // ❌ EXTREMELY DANGEROUS
   {
     write:;
     ["/etc", "/usr", "/bin"];
   }
   ```

4. **Don't Allow Subprocess Execution Without Validation**:

   ```typescript
   // ❌ BAD - can run any command
   {
     run: true;
   }

   // ✅ GOOD - specific commands only
   {
     run:;
     ["git", "npm"];
   }
   ```

5. **Don't Ignore Errors**:

   ```typescript
   // ❌ BAD - silent failures
   await conductor.execute(convId, code).catch(() => {});

   // ✅ GOOD - handle and log
   try {
     await conductor.execute(convId, code);
   } catch (error) {
     logger.error("Execution failed", error);
     throw error;
   }
   ```

### Security Checklist

Before deploying to production, verify:

- [ ] All permissions follow least-privilege principle
- [ ] No `all: true` permissions in any configuration
- [ ] Timeouts are set appropriately (default 30s)
- [ ] User input is validated before execution
- [ ] File system access is restricted to specific directories
- [ ] Network access is limited to required domains
- [ ] Audit logging is enabled and monitored
- [ ] Dependencies are installed in two-step process
- [ ] `--no-prompt` flag is active (automatic)
- [ ] Error messages don't leak sensitive information

### Threat Model

#### What MCP Conductor Protects Against:

✅ **Arbitrary code execution** - Sandboxed in V8 isolate ✅ **File system access** - Explicit
permission required ✅ **Network exfiltration** - Network access denied by default ✅ **Resource
exhaustion** - Timeout and memory limits ✅ **Dependency injection** - Two-step installation process
✅ **Permission escalation** - No interactive prompts

#### What MCP Conductor Does NOT Protect Against:

⚠️ **Malicious MCP servers** - Validate server sources ⚠️ **Side-channel attacks** - Timing, memory
patterns ⚠️ **Social engineering** - User grants excessive permissions ⚠️ **LLM prompt injection** -
Validate LLM outputs before execution

### Reporting Security Issues

Found a security vulnerability? Please report it via
[GitHub Security Advisories](https://github.com/niradler/mcp-conductor/security/advisories).

We follow responsible disclosure and will:

1. Acknowledge receipt within 48 hours
2. Provide a fix timeline within 7 days
3. Credit researchers in security advisories

---

## FAQ

**Q: Why TypeScript only, not Python?**\
A: TypeScript provides excellent safety and tooling. Python support via Pyodide is planned for the
future.

**Q: Can I use this with GPT-4 or other LLMs?**\
A: Yes! Works with any LLM that supports MCP and can write TypeScript/JavaScript.

**Q: How does MCP Proxy differ from direct MCP integration?**\
A: MCP Proxy lets your executed code call tools from multiple MCP servers within a single execution.
Instead of the LLM making separate tool calls through the MCP protocol, it writes code that
orchestrates multiple MCP servers together using the `mcpFactory` object.

**Q: What about security?**\
A: MCP Conductor uses Deno's permission model + V8 isolation for strong sandboxing. All code runs
with zero permissions by default, and the `--no-prompt` flag prevents permission escalation.
Dependencies are installed in a two-step process (write → read-only) following industry best
practices. See the [Security](#security) section above for comprehensive details.

**Q: Can I use my existing MCP servers with the proxy?**\
A: Yes! Any standard MCP server that supports stdio or SSE transport can be configured in the
`mcp-config.json` file.

**Q: How do I debug code execution failures?**\
A: Check the stderr output returned by `run_deno_code`. Common issues include missing permissions,
dependency not in allowlist, or timeout exceeded.

---

<div align="center">

**Built with ❤️ for the AI agent community**

[⭐ Star on GitHub](https://github.com/niradler/mcp-conductor) | [📖 Documentation](docs/) |
[🐛 Report Issues](https://github.com/niradler/mcp-conductor/issues)
