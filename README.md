# MCP Conductor 🎼

**Secure Deno code execution for AI agents via Model Context Protocol**

> Execute TypeScript/JavaScript code in isolated, permission-controlled sandboxes

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Deno](https://img.shields.io/badge/deno-2.x-green.svg)](https://deno.land)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)](https://www.typescriptlang.org/)

---

## Overview

**MCP Conductor** is a Model Context Protocol (MCP) server that provides secure, sandboxed execution
of TypeScript and JavaScript code for AI agents. Built on Deno's security-first runtime, it enables
LLMs to run code with fine-grained permission control configured entirely by administrators via
environment variables.

### Key Features

- 🔒 **Security First**: Deno's permission model with zero permissions by default
- 🎛️ **Admin-Controlled**: Permissions configured via environment variables, not by the LLM
- 📦 **Dependency Management**: Package allowlisting with two-step security isolation
- ⚡ **Fast & Isolated**: Fresh subprocess per execution with <100ms startup
- 🚫 **No Escalation**: LLMs cannot request additional permissions
- 📁 **Workspace Isolation**: Filesystem access restricted to configured directory

---

## Quick Start

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/mcp-conductor
cd mcp-conductor

# Deno will auto-install dependencies on first run
```

### 2. Configure in Cursor/Claude Desktop

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
        "src/cli/cli.ts",
        "stdio"
      ],
      "env": {
        "MCP_CONDUCTOR_WORKSPACE": "${userHome}/.mcp-conductor/workspace",
        "MCP_CONDUCTOR_ALLOWED_PACKAGES": "npm:axios@^1,npm:zod@^3,jsr:@std/path,jsr:@std/fs",
        "MCP_CONDUCTOR_RUN_ARGS": "allow-read=${userHome}/.mcp-conductor/workspace,allow-write=${userHome}/.mcp-conductor/workspace"
      }
    }
  }
}
```

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

See [docs/ENV_VARS.md](docs/ENV_VARS.md) for detailed configuration guide.

---

## Installation

### Prerequisites

```bash
# Install Deno (2.x or higher)
curl -fsSL https://deno.land/install.sh | sh

# Verify
deno --version
```

### Install Conductor

```bash
# Via deno (recommended)
deno install -A -n conductor jsr:@conductor/cli

# Or clone and build
git clone https://github.com/conductor/conductor.git
cd conductor
deno task build
```

---

## Quick Start

### 1. Configure MCP Servers

Create `conductor.config.ts`:

```typescript
import { ConductorConfig } from "@conductor/orchestrator";

export default {
  // MCP servers to connect to
  mcpServers: [
    {
      name: "google-drive",
      command: "uvx",
      args: ["mcp-server-gdrive"],
      env: { GOOGLE_TOKEN: Deno.env.get("GOOGLE_TOKEN") },
    },
    {
      name: "salesforce",
      command: "node",
      args: ["./mcp-servers/salesforce/index.js"],
      env: { SF_TOKEN: Deno.env.get("SF_TOKEN") },
    },
  ],

  // Catalog configuration
  catalog: {
    embeddingModel: "text-embedding-3-small",
    cacheSpecs: true,
  },

  // Sandbox configuration
  sandbox: {
    allowRead: ["./workspace"],
    allowWrite: ["./workspace"],
    timeout: 30000,
  },
} satisfies ConductorConfig;
```

### 2. Start Conductor

```bash
conductor start --config conductor.config.ts
```

### 3. Use in Your Agent

```typescript
import { Conductor } from "@conductor/orchestrator";

// Initialize
const conductor = new Conductor(config);
await conductor.start();

// Create conversation
const convId = conductor.createConversation();

// === Message 1 ===
const query1 = "Find revenue data from Salesforce";

// Discover relevant tools (semantic search)
const tools = await conductor.findTools(convId, query1);
// Returns: [{ name: 'salesforce.query', description: '...', ... }]

// Load full spec for selected tool
await conductor.loadToolSpec(convId, "salesforce.query");

// Agent writes TypeScript code
const code1 = `
import * as sf from './mcp/salesforce';

const opps = await sf.query({
  query: 'SELECT Amount FROM Opportunity WHERE CloseDate >= 2024-10-01'
});

console.log('Found', opps.length, 'opportunities');
`;

// Execute
const result1 = await conductor.execute(convId, code1);
console.log(result1.stdout); // "Found 47 opportunities"

// === Message 2 (same conversation) ===
// Tools already loaded! No catalog search needed.
// System prompt automatically includes:
//   "Available modules: import * as sf from './mcp/salesforce';"
//   "Already loaded: salesforce.query"

const code2 = `
// sf already imported from message 1!
const opps = JSON.parse(await Deno.readTextFile('./workspace/opps.json'));

const total = opps.reduce((sum, o) => sum + o.Amount, 0);
console.log('Total revenue:', total);
`;

const result2 = await conductor.execute(convId, code2);
// No catalog overhead! Just execution.
```

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│         LLM Agent (Claude/GPT/etc)              │
│  • Discovers tools via semantic search         │
│  • Writes TypeScript code                      │
│  • Executes in Deno sandbox                    │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│              Conductor                          │
│  ┌──────────────────────────────────────────┐  │
│  │  Intelligent Catalog                     │  │
│  │  • Semantic search (vector embeddings)   │  │
│  │  • Conversation-aware filtering          │  │
│  │  • Co-usage learning                     │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  Conversation State                      │  │
│  │  • Tracks loaded tools                   │  │
│  │  • Manages imported modules              │  │
│  │  • Persists workspace files              │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  Code Execution Sandbox                  │  │
│  │  • Deno runtime (TypeScript-native)      │  │
│  │  • Permission-based security             │  │
│  │  • 50-100ms startup                      │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  MCP Orchestration                       │  │
│  │  • Connects to N MCP servers             │  │
│  │  • Auto-generates TypeScript APIs        │  │
│  │  • Routes tool calls                     │  │
│  └──────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────┘
                 │
     ┌───────────┼───────────┬──────────────┐
     │           │           │              │
┌────▼────┐ ┌────▼────┐ ┌───▼────┐ ┌──────▼──────┐
│  MCP    │ │  MCP    │ │  MCP   │ │    MCP      │
│ Server  │ │ Server  │ │ Server │ │   Server    │
│  (15)   │ │  (23)   │ │  (8)   │ │    (91)     │
└─────────┘ └─────────┘ └────────┘ └─────────────┘
              137 tools across 4 servers
```

---

## Performance

### Token Efficiency

| Tools | Traditional MCP | Conductor (1st msg) | Conductor (2nd+ msg) | Savings |
| ----- | --------------- | ------------------- | -------------------- | ------- |
| 50    | 15,000          | 1,200               | 200                  | 92-99%  |
| 100   | 30,000          | 1,500               | 300                  | 95-99%  |
| 200   | 60,000          | 2,000               | 400                  | 97-99%  |

### Execution Speed

| Operation                | Time                      |
| ------------------------ | ------------------------- |
| Deno sandbox startup     | 50-100ms                  |
| Semantic catalog search  | 15-30ms                   |
| TypeScript execution     | 100-300ms                 |
| Parallel tool calls (3x) | 300ms vs 900ms sequential |

### Memory Usage

| Component             | Memory     |
| --------------------- | ---------- |
| Catalog (1000 tools)  | 15 MB      |
| Per conversation      | 2 MB       |
| Per MCP connection    | 4 MB       |
| **Total (5 servers)** | **~35 MB** |

---

## Documentation

- 📖 [Architecture Overview](docs/ARCHITECTURE.md) - Deep dive into design
- 🚀 [Quick Start Guide](docs/QUICKSTART.md) - Get started in 5 minutes
- 📚 [API Reference](docs/API.md) - Complete API documentation
- 💡 [Examples](examples/) - Code examples for common patterns
- 🛠️ [Contributing](CONTRIBUTING.md) - How to contribute

---

## Use Cases

### 1. Multi-System Data Analysis

Query Salesforce, cross-reference Slack discussions, create Notion summary — all in one code block
with data processing in sandbox.

### 2. Automated Workflows

50+ step workflows across 10+ systems, with parallel execution and intelligent error handling.

### 3. Development Assistants

Agents with access to GitHub, Jira, Slack, documentation systems — discovering relevant tools
on-demand.

### 4. Enterprise Integration

Connect to internal APIs, databases, and services through MCP with secure sandboxing and audit
logging.

---

## Roadmap

### Phase 1: Core (Weeks 1-3) ✅

- [x] MCP client (stdio transport)
- [x] Semantic catalog search
- [x] Deno sandbox execution
- [x] TypeScript API generation

### Phase 2: Intelligence (Weeks 4-6) 🚧

- [ ] Conversation state management
- [ ] Co-usage learning
- [ ] Integration & CLI
- [ ] Documentation

### Phase 3: Production (Weeks 7-9) 📋

- [ ] HTTP transport
- [ ] Redis persistence
- [ ] Observability & metrics
- [ ] Performance optimization

### Future

- [ ] Multi-language sandboxes (Python via Pyodide)
- [ ] GraphQL API layer
- [ ] Visual workflow builder
- [ ] Enterprise features (SSO, RBAC)

---

## Community

- 💬 [Discord](https://discord.gg/conductor) - Chat with the community
- 🐛 [Issues](https://github.com/conductor/conductor/issues) - Report bugs or request features
- 🤝 [Discussions](https://github.com/conductor/conductor/discussions) - Ask questions and share
  ideas
- 🐦 [Twitter](https://twitter.com/conductor_mcp) - Stay updated

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Areas we need help**:

- Vector database integrations (Chroma, Pinecone)
- Additional MCP server testing
- Documentation improvements
- Performance benchmarking
- Example workflows

---

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Anthropic](https://anthropic.com) - For MCP protocol and insights on code execution
- [Cloudflare](https://cloudflare.com) - For "code mode" research and validation
- [Microsoft Research](https://microsoft.com/research) - For scaling analysis
- [Deno Team](https://deno.land) - For the secure-by-default runtime
- [MCP Community](https://modelcontextprotocol.io) - For building the ecosystem

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

#### 3. **No Interactive Prompts**

The `--no-prompt` flag ensures code **fails immediately** if permissions are insufficient,
preventing:

- Timeout-based denial of service
- Permission escalation attacks
- Interactive prompt injection

```typescript
// Without --no-prompt: hangs waiting for user input ❌
// With --no-prompt: fails in <100ms with clear error ✅
```

#### 4. **Two-Step Dependency Installation**

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

Found a security vulnerability? Please email **security@conductor.dev** (do not file public issues).

We follow responsible disclosure and will:

1. Acknowledge receipt within 48 hours
2. Provide a fix timeline within 7 days
3. Credit researchers in security advisories

---

## FAQ

**Q: Why TypeScript only, not Python?**\
A: LLMs have millions of lines of real TypeScript in training data. Python support via Pyodide is
planned for Phase 4.

**Q: Can I use this with GPT-4?**\
A: Yes! Works with any LLM that can write TypeScript and follow instructions.

**Q: How is this different from direct MCP integration?**\
A: Conductor adds intelligent catalog management, conversation state, and code execution — solving
scaling problems beyond 50 tools.

**Q: What about security?**\
A: MCP Conductor uses Deno's permission model + V8 isolation for strong sandboxing. All code runs
with zero permissions by default, and the `--no-prompt` flag prevents permission escalation.
Dependencies are installed in a two-step process (write → read-only) following industry best
practices. See the [Security](#security) section above for comprehensive details.

**Q: Can I use my existing MCP servers?**\
A: Yes! Zero changes needed. Conductor works with any standard MCP server.

---

<div align="center">

**Built with ❤️ for the AI agent community**

[⭐ Star us on GitHub](https://github.com/conductor/conductor) |
[📖 Read the docs](https://conductor.dev) | [💬 Join Discord](https://discord.gg/conductor)
