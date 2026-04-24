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

1. Generate a hash for your API key:

   ```bash
   pnpm hash-key my-secret-key
   # sha256:...
   ```

2. Copy `examples/conductor.json` to the repo root (or any path) and paste the hash into `users[].apiKeyHash`.
3. Start the gateway pointing at your config:

   ```bash
   CONDUCTOR_CONFIG=examples/conductor.json pnpm dev
   ```

   The gateway listens on the `server.host`/`server.port` from the config (default `0.0.0.0:3000`).
4. Connect any MCP client to `http://localhost:3000/mcp` with header `Authorization: Bearer my-secret-key`.

The bundled example config spawns `@modelcontextprotocol/server-everything` over `npx` so you can see real tools end-to-end without writing your own upstream.

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
