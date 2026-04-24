# mcp-conductor

Tool gateway for AI agents. Speaks MCP to clients. Aggregates tools from multiple backends behind auth + group-based access control, with full audit.

Backends implement a common `ToolProvider` interface. Current release ships a provider for **MCP upstream servers** (stdio). Planned: OpenAPI, GraphQL, HTTP tools, sandbox.

## Packages

| Package | Purpose |
| --- | --- |
| [`@mcp-conductor/core`](packages/core) | Foundation: `ToolProvider` interface, data-access stores (config + audit), logger, OpenTelemetry, graceful shutdown. |
| [`@mcp-conductor/provider-mcp`](packages/provider-mcp) | MCP upstream adapter — spawns and talks to an MCP server over stdio. |
| [`@mcp-conductor/gateway`](packages/gateway) | HTTP MCP server: auth, group access control, audit, namespacing. Consumes any `ToolProvider[]`. |
| [`@mcp-conductor/server`](packages/server) | CLI binary (`mcp-conductor`) that loads `conductor.json` and wires providers into the gateway. |

## Requirements

- Node.js ≥ 20.11
- pnpm ≥ 9

## Setup

```bash
pnpm install
pnpm build
pnpm test       # 95 tests across 4 packages
pnpm typecheck
```

## Quick start

`examples/conductor.json` ships with user `alice` whose API key is `changeme` (hash baked in) and one provider that runs `@modelcontextprotocol/server-everything` over `npx`. Enough to see real tools end-to-end without any config edits:

```bash
CONDUCTOR_CONFIG=examples/conductor.json pnpm dev
# listens on 127.0.0.1:3000, exposes 13 tools as everything__*
```

Connect any MCP client to `http://127.0.0.1:3000/mcp` with `Authorization: Bearer changeme`.

### Using your own API key

```bash
pnpm hash-key my-secret-key
# sha256:...
```

Copy `examples/conductor.json` to your own path, replace the `apiKeyHash` with the output above, and point `CONDUCTOR_CONFIG` at it.

## Environment variables

| Var | Meaning | Default |
| --- | --- | --- |
| `CONDUCTOR_CONFIG` | Path to `conductor.json`. | `./conductor.json` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP endpoint for traces. If unset, telemetry is a no-op. | unset |

## Config shape

Defined by the Zod schema in [packages/server/src/conductor-config.ts](packages/server/src/conductor-config.ts). Top level:

- `server` — `host`, `port`, `maxSessions`
- `users[]` — `name`, `apiKeyHash` (must match `sha256:<64 hex>`), `groups[]`
- `groups[]` — `name`, `providers[]` (provider names or `["*"]` for all)
- `providers[]` — currently `{ type: "mcp", name, transport: "stdio", command, args, env, ... }`
- `audit` — `{ type: "console", bufferSize? }`
- `telemetry` — `{ serviceName, otlpEndpoint }`

Tools are namespaced by provider when exposed to clients: a tool `echo` on provider `everything` appears as `everything__echo`.
