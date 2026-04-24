# mcp-conductor

> A tool gateway for AI agents. One MCP endpoint, many upstreams, real auth, real audit.

`mcp-conductor` speaks [Model Context Protocol](https://modelcontextprotocol.io) to your agent and aggregates tools from any number of backends behind bearer-token auth, group-based access control, and a full call-by-call audit log. Agents stop caring how a tool is implemented; you stop pasting API keys into agent configs.

Backends implement a common `ToolProvider` interface. The current release ships a provider for **MCP upstream servers** (stdio). Planned: OpenAPI, GraphQL, HTTP tools, and sandboxed execution (OpenShell).

```
┌──────────────┐  MCP/HTTP   ┌───────────────────────────┐   stdio/…   ┌─────────────┐
│  MCP client  │ ──────────▶ │       mcp-conductor       │ ──────────▶ │  upstream   │
│  (agent/IDE) │             │  auth · groups · audit    │             │  MCP server │
└──────────────┘             │  tool namespacing (__)    │             └─────────────┘
                             └───────────────────────────┘       also: OpenAPI · GraphQL · …
```

## Highlights

- **One MCP endpoint, many tools.** Upstreams are abstracted behind a `ToolProvider` contract; tools are exposed namespaced as `<provider>__<tool>`.
- **Real auth.** SHA-256 hashed API keys, timing-safe comparison. Keys never sit in config as plaintext.
- **Group-based access control.** Users belong to groups; groups grant providers (or `"*"` for all).
- **Audit everything.** Every tool call is recorded with user, provider, tool, redacted args, duration, status, and request id.
- **Observability built in.** Structured JSON logs; OpenTelemetry spans per tool call when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
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

13 tools appear, namespaced as `everything__*`.

Sanity check over HTTP:

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

The config is a single JSON file validated by Zod at load time (schema: [`packages/server/src/conductor-config.ts`](packages/server/src/conductor-config.ts)). Unknown keys are rejected.

```jsonc
{
  "server": { "host": "127.0.0.1", "port": 18080, "maxSessions": 100 },
  "users": [
    { "name": "alice", "apiKeyHash": "sha256:…", "groups": ["admins"] },
  ],
  "groups": [{ "name": "admins", "providers": ["*"] }],
  "providers": [
    {
      "type": "mcp",
      "name": "everything",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
      "env": {},
    },
  ],
  "audit": { "type": "console" },
  "telemetry": { "serviceName": "mcp-conductor", "otlpEndpoint": "" },
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

## Architecture

`mcp-conductor` is a pnpm workspace with a strict dependency layering.

| Package                                                            | Role                                                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@mcp-conductor/core`](packages/core)                             | `ToolProvider` interface, `ProviderRegistry`, audit & config stores, logger, OTel bootstrap, shutdown registry. No sibling deps.                   |
| [`@mcp-conductor/provider-mcp`](packages/provider-mcp)             | `ToolProvider` that spawns an upstream MCP server over stdio. Handles timeouts and reconnect.                                                      |
| [`@mcp-conductor/provider-openshell`](packages/provider-openshell) | `ToolProvider` for [NVIDIA OpenShell](docs/policy.md) (gRPC). Protos vendored; regenerate with `pnpm update-openshell-protos`. _Currently a stub._ |
| [`@mcp-conductor/gateway`](packages/gateway)                       | The HTTP MCP server. Auth, groups, audit wrapping, namespacing, session manager. Accepts any `ToolProvider[]`.                                     |
| [`@mcp-conductor/server`](packages/server)                         | The CLI (`mcp-conductor`). Loads `conductor.json`, wires providers into the gateway, owns signals.                                                 |

### Request lifecycle

1. **Authenticate.** Bearer token → timing-safe SHA-256 compare against each user's `apiKeyHash`. Bad token → `401`.
2. **Resolve access.** User's groups → set of reachable providers (`"*"` expands to all configured).
3. **Session.** New session = MCP `initialize` request. The gateway assembles a per-session MCP server that only advertises tools the caller may see.
4. **Namespacing.** Tools are registered as `<provider>__<tool>`. The separator `__` is reserved; provider names must not contain it.
5. **Call.** The handler decodes `<provider>__<tool>`, forwards to the audit-wrapped provider with `{ user, requestId, signal }`. Providers must honour `signal` for cancellation.
6. **Audit + trace.** One `AuditStore.insertCall` per invocation with redacted args, status, duration, request id. One OTel span per call.
7. **Shutdown.** LIFO: HTTP server → sessions → providers → audit → telemetry.

### Writing a provider

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
  async connect(): Promise<void> {
    /* … */
  }
  async close(): Promise<void> {
    /* … */
  }
  async listTools(): Promise<ToolSpec[]> {
    /* … */
  }
  async callTool(
    name: string,
    args: unknown,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    // honour ctx.signal for cancellation
  }
}
```

Register it with the `ProviderRegistry` — or, for config-driven loading, add a branch to `packages/server/src/provider-factory.ts` and extend `ProviderEntrySchema`.

## Development

```bash
pnpm build          # tsc -p tsconfig.build.json per package
pnpm typecheck      # tsc --noEmit (includes tests)
pnpm test           # vitest — 95 tests across 4 packages
pnpm test:watch
pnpm clean          # rm -rf dist/ .tsbuildinfo
```

Run a single test file:

```bash
pnpm test -- packages/gateway/tests/auth.test.ts
pnpm test -- packages/gateway/tests/auth.test.ts -t "rejects invalid bearer"
```

> [!IMPORTANT]
> This is ESM-only (`"type": "module"`, NodeNext resolution). Local imports **must** use the `.js` extension — TypeScript compiles to ESM `.js` and NodeNext will not resolve extensionless imports.

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
  update-openshell-protos.ts
docs/
  policy.md                        OpenShell policy schema reference
  superpowers/plans/               implementation plans for larger work
```

## Protocol notes

- **Transport.** Streamable HTTP (`@modelcontextprotocol/sdk`). One `initialize` request opens a session; subsequent requests must carry `mcp-session-id`. Non-initialize traffic without a session gets `400`.
- **Tool schema.** The gateway passes upstream JSON Schema through as `z.unknown()` per property. Upstream remains the source of truth for validation — the gateway never rewrites tool inputs.
- **Correlation.** Every request gets an `X-Request-Id` (echoed on response and threaded through `ToolCallContext` and the audit log).

## License

MIT. See [LICENSE](LICENSE).
