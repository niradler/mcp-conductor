<div align="center">

# conductor

**A tool gateway for AI agents — one MCP endpoint, many upstreams, real auth, real audit.**

[![Node.js](https://img.shields.io/badge/Node.js->=20.11-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm->=9-f69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-1.0-purple?style=flat-square)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

[Highlights](#highlights) • [Quick start](#quick-start) • [Configuration](#configuration) • [Architecture](#architecture) • [Writing a provider](#writing-a-provider) • [Development](#development)

</div>

`conductor` speaks [Model Context Protocol](https://modelcontextprotocol.io) to your agent and aggregates tools from any number of backends behind bearer-token auth, group-based access control, and a full call-by-call audit log. **Agents stop caring how a tool is implemented; you stop pasting API keys into agent configs.**

Backends implement a common `ToolProvider` interface. Today: **MCP upstream servers** over stdio. Planned: OpenAPI, GraphQL, HTTP tools, and **sandboxed code & CLI execution** via OpenShell — install your CLI in the sandbox image and call it through `sandbox_exec` instead of writing a one-off MCP wrapper.

## Why this exists

Connecting many MCP servers directly to an agent is a context-tax trap. Each upstream's tool list and schemas get pre-loaded into the LLM's context window before the user has typed a word — the official GitHub MCP alone is ~50K tokens, and model accuracy starts dropping past ~100K ("Lost in the Middle"). Conductor sits in front of N upstreams as a **single MCP endpoint** and gives agents *lazy, governed* discovery: see only what the caller's role permits, list providers and tools on demand instead of all-at-once, audit and rate-limit every call, and (planned) **pre-filter tools by intent** so the model never sees the other 95%. The CLI-vs-MCP debate misses the point — use a local CLI when you want context-cheap and personal; use conductor when you need governance, audit, RBAC, and one endpoint across teams.

```
┌──────────────┐  MCP/HTTP   ┌───────────────────────────┐   stdio/…   ┌─────────────┐
│  MCP client  │ ──────────▶ │         conductor         │ ──────────▶ │  upstream   │
│  (agent/IDE) │             │  auth · groups · audit    │             │  MCP server │
└──────────────┘             │  tool namespacing (__)    │             └─────────────┘
                             └───────────────────────────┘       also: OpenAPI · GraphQL · …
```

## Highlights

- **One endpoint, many tools.** Upstreams are abstracted behind a `ToolProvider` contract; tools are exposed namespaced as `<provider>__<tool>`.
- **Lazy tool discovery.** Built-in `conductor__list_providers` and `conductor__list_tools` meta-tools let agents discover capabilities on demand instead of pre-loading every tool's schema into context. Provider-level descriptions and instructions are surfaced from each upstream's `serverInfo` / `initialize` payload.
- **Real auth.** SHA-256 hashed API keys, timing-safe comparison. Plaintext keys never appear in config.
- **Group-based access control.** Users belong to groups; groups grant providers (or `"*"` for all).
- **Audit everything.** Every tool call records user, provider, tool, redacted args, duration, status, and request id.
- **Observability built in.** Structured JSON logs; OpenTelemetry spans per call when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- **Graceful lifecycle.** Clean LIFO shutdown: HTTP → sessions → providers → audit → telemetry.
- **Zero-ceremony start.** Ships a working config with a dummy key — clone, install, run, connect.

## Quick start

> [!NOTE]
> Requires **Node.js ≥ 20.11** and **pnpm ≥ 9**.

```bash
pnpm install
pnpm build
CONDUCTOR_CONFIG=examples/conductor.json pnpm dev
```

The bundled `examples/conductor.json` boots with user `alice` (API key `changeme`, hash baked in) and one upstream provider (`everything` via `npx @modelcontextprotocol/server-everything`).

Connect any MCP client:

```
URL:    http://127.0.0.1:18080/mcp
Header: Authorization: Bearer changeme
```

13 tools appear, namespaced as `everything__*`. Sanity check:

```bash
curl http://127.0.0.1:18080/health
# {"ok":true,"sessions":0,"providers":["everything"]}
```

### Use your own API key

```bash
pnpm hash-key my-secret-key
# sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069
```

Copy `examples/conductor.json`, paste the hash into `users[].apiKeyHash`, point `CONDUCTOR_CONFIG` at your copy.

## Configuration

A single JSON file, validated by Zod at load time. Schema lives at [`packages/server/src/conductor-config.ts`](packages/server/src/conductor-config.ts). Unknown keys are rejected.

```jsonc
{
  "server": { "host": "127.0.0.1", "port": 18080, "maxSessions": 100 },
  "users": [
    { "name": "alice", "apiKeyHash": "sha256:…", "groups": ["admins"] }
  ],
  "groups": [{ "name": "admins", "providers": ["*"] }],
  "providers": [
    {
      "type": "mcp",
      "name": "everything",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
      "env": {}
    }
  ],
  "audit": { "type": "console" },
  "telemetry": { "serviceName": "conductor", "otlpEndpoint": "" }
}
```

### Top-level fields

| Field         | Purpose                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `server`      | `host`, `port`, `maxSessions` — bind address and session LRU cap.            |
| `users[]`     | `name`, `apiKeyHash` (`sha256:<64 hex>`), `groups[]`.                        |
| `groups[]`    | `name`, `providers[]` (provider names, or `["*"]` for all).                  |
| `providers[]` | Discriminated on `type`. Today: `"mcp"` (stdio). More types incoming.        |
| `audit`       | Currently `{ "type": "console" }` with optional `bufferSize`.                |
| `telemetry`   | `serviceName` + `otlpEndpoint`. Traces are a no-op if the endpoint is unset. |

### MCP provider options

| Field                      | Default | Notes                                                          |
| -------------------------- | ------- | -------------------------------------------------------------- |
| `command`, `args`, `env`   | —       | How to spawn the upstream.                                     |
| `initialListTimeoutMs`     | `15000` | Deadline for the first `tools/list` after connect.             |
| `callTimeoutMs`            | `60000` | Per-call timeout forwarded as an `AbortSignal`.                |
| `reconnect.maxAttempts`    | `10`    | Exponential backoff between `initialDelayMs` and `maxDelayMs`. |
| `reconnect.initialDelayMs` | `1000`  |                                                                |
| `reconnect.maxDelayMs`     | `30000` |                                                                |

### Environment variables

| Var                           | Meaning                                       | Default            |
| ----------------------------- | --------------------------------------------- | ------------------ |
| `CONDUCTOR_CONFIG`            | Path to `conductor.json`.                     | `./conductor.json` |
| `PORT`                        | Overrides `server.port` after config load.    | —                  |
| `LOG_LEVEL`                   | `debug`, `info`, `warn`, `error`.             | `info`             |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP base URL. Traces disabled if unset. | —                  |

> [!IMPORTANT]
> Never commit plaintext API keys. Run `pnpm hash-key <plaintext>` and store only the resulting `sha256:…` digest.

## Architecture

`conductor` is a pnpm workspace with strict dependency layering — `core` has no sibling deps, providers and the gateway depend only on `core`, and `server` wires it all together.

| Package                                                            | Role                                                                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`@mcp-conductor/core`](packages/core)                                 | `ToolProvider` interface, `ProviderRegistry`, audit & config stores, logger, OTel bootstrap, shutdown registry. No sibling deps.       |
| [`@mcp-conductor/provider-mcp`](packages/provider-mcp)                 | `ToolProvider` that spawns an upstream MCP server over stdio. Handles timeouts and reconnect.                                          |
| [`@mcp-conductor/provider-openshell`](packages/provider-openshell)     | `ToolProvider` for [NVIDIA OpenShell](docs/) (gRPC). Protos vendored; regenerate with `pnpm update-openshell-protos`. _Currently a stub._ |
| [`@mcp-conductor/gateway`](packages/gateway)                           | The HTTP MCP server. Auth, groups, audit wrapping, namespacing, session manager. Accepts any `ToolProvider[]`.                         |
| [`@mcp-conductor/server`](packages/server)                             | The CLI (`conductor`). Loads `conductor.json`, wires providers into the gateway, owns signals.                                         |

### Request lifecycle

1. **Authenticate.** Bearer token → timing-safe SHA-256 compare against each user's `apiKeyHash`. Bad token → `401`.
2. **Resolve access.** User's groups → set of reachable providers (`"*"` expands to all configured).
3. **Session.** New session = MCP `initialize` request. The gateway assembles a per-session MCP server that only advertises tools the caller may see.
4. **Namespace.** Tools are registered as `<provider>__<tool>`. The separator `__` is reserved; provider names must not contain it.
5. **Call.** The handler decodes `<provider>__<tool>`, forwards to the audit-wrapped provider with `{ user, requestId, signal }`. Providers must honour `signal` for cancellation.
6. **Audit + trace.** One `AuditStore.insertCall` per invocation with redacted args, status, duration, request id. One OTel span per call.
7. **Shutdown.** LIFO: HTTP server → sessions → providers → audit → telemetry.

### Repository layout

```
packages/
  core/                 foundation: ToolProvider, stores, logger, OTel, lifecycle
  provider-mcp/         stdio MCP upstream adapter
  provider-openshell/   OpenShell gRPC provider (stub; protos vendored)
  gateway/              HTTP MCP server, auth, groups, audit, namespacing
  server/               CLI binary: config + wiring
examples/
  conductor.json        working example config (alice / changeme)
scripts/
  hash-api-key.ts       prints sha256:<hex> for an API key
docs/
  plans/                roadmap and implementation plans
```

## Writing a provider

Implement `ToolProvider` from `@mcp-conductor/core`:

```ts
import type {
  ToolProvider,
  ToolSpec,
  ToolCallContext,
  ToolCallResult,
} from "@mcp-conductor/core";

export class MyProvider implements ToolProvider {
  readonly name = "my-provider";

  async connect(): Promise<void> { /* … */ }
  async close(): Promise<void> { /* … */ }
  async listTools(): Promise<ToolSpec[]> { /* … */ }

  async callTool(
    name: string,
    args: unknown,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    // honour ctx.signal for cancellation
  }
}
```

Register it with the `ProviderRegistry` — or, for config-driven loading, add a branch to [`packages/server/src/provider-factory.ts`](packages/server/src/provider-factory.ts) and extend `ProviderEntrySchema`.

## Development

```bash
pnpm build          # tsc -p tsconfig.build.json per package
pnpm typecheck      # tsc --noEmit (includes tests)
pnpm test           # vitest — 255 tests across all packages
pnpm test:watch
pnpm clean          # rm -rf dist/ .tsbuildinfo
```

Run a single test file or test name:

```bash
pnpm test -- packages/gateway/tests/auth.test.ts
pnpm test -- packages/gateway/tests/auth.test.ts -t "rejects invalid bearer"
```

> [!IMPORTANT]
> This is ESM-only (`"type": "module"`, NodeNext resolution). Local imports **must** use the `.js` extension — TypeScript compiles to ESM `.js` and NodeNext will not resolve extensionless imports.

## Protocol notes

- **Transport.** Streamable HTTP (`@modelcontextprotocol/sdk`). One `initialize` request opens a session; subsequent requests must carry `mcp-session-id`. Non-initialize traffic without a session gets `400`.
- **Tool schema.** The gateway passes upstream JSON Schema through as `z.unknown()` per property. Upstream remains the source of truth for validation — the gateway never rewrites tool inputs.
- **Correlation.** Every request gets an `X-Request-Id` (echoed on the response and threaded through `ToolCallContext` and the audit log).

> [!TIP]
> See [`docs/plans/`](docs/plans/) for the roadmap — OpenAPI, GraphQL, HTTP tools, and OpenShell sandboxed execution are next.
