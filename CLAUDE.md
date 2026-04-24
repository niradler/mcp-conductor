# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project summary

mcp-conductor is a tool gateway for AI agents. It speaks MCP to clients and aggregates tools from multiple backends (`ToolProvider` implementations) behind bearer-token auth, group-based access control, and full audit. Packaged as a pnpm workspace.

## Commands

Run from the repo root — all scripts fan out across packages via pnpm workspace filters.

- `pnpm install` — install + link workspaces
- `pnpm build` — `tsc -p tsconfig.build.json` in each package (`packages/*`)
- `pnpm typecheck` — `tsc --noEmit` per package (checks both `src/` and `tests/`)
- `pnpm test` — run the full vitest suite (workspace config at `vitest.workspace.ts`)
- `pnpm test:watch` — vitest in watch mode
- `pnpm clean` — wipe `dist/` and `.tsbuildinfo` everywhere
- `pnpm dev` — run the server via `tsx packages/server/src/cli.ts` (honours `CONDUCTOR_CONFIG`)
- `pnpm hash-key <plaintext>` — prints `sha256:<hex>` for an API key (what the config expects)

### Running a single test

Vitest's workspace picks up each package's `vitest.config.ts`. Target a specific file by path, and narrow inside a file with `-t`:

```bash
pnpm test -- packages/gateway/tests/auth.test.ts
pnpm test -- packages/gateway/tests/auth.test.ts -t "rejects invalid bearer"
# or scope by project name (packages self-name: "core", "gateway", etc.)
pnpm test -- --project gateway
```

### Running the gateway locally

The repo ships a working config at `examples/conductor.json` (user `alice`, key `changeme`, one provider `everything` via `npx @modelcontextprotocol/server-everything`):

```bash
CONDUCTOR_CONFIG=examples/conductor.json pnpm dev
# → http://127.0.0.1:18080/mcp  (Authorization: Bearer changeme)
# → GET /health returns { ok, sessions, providers }
```

## Architecture

Five packages in `packages/*`, strict layering — core has no sibling deps; gateway/provider-mcp/provider-openshell depend on core; server wires everything.

### Package map

| Package                             | Role                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mcp-conductor/core`               | Foundation. Exports `ToolProvider` interface, `ProviderRegistry`, `AuditStore` + `ConsoleAuditStore`, `JsonFileConfigStore`, `createLogger`, OTel bootstrap (`initTelemetry`/`shutdownTelemetry`), `createShutdownRegistry`, shared `Result`/`Timed` types, error classes. Subpath exports: `./data`, `./providers`. |
| `@mcp-conductor/provider-mcp`       | `ToolProvider` that spawns an upstream MCP server over stdio and proxies `list`/`call` with timeouts and reconnect.                                                                                                                                                                                                  |
| `@mcp-conductor/provider-openshell` | `ToolProvider` for NVIDIA OpenShell (gRPC). Ships vendored protos under `proto/`; regenerate with `pnpm update-openshell-protos`. Currently a stub.                                                                                                                                                                  |
| `@mcp-conductor/gateway`            | The HTTP MCP server. Consumes any `ToolProvider[]` via a `ProviderRegistry`. Exports `startGateway()` and the lower-level `exportMcpApp()`. Not tied to any specific provider.                                                                                                                                       |
| `@mcp-conductor/server`             | CLI binary `mcp-conductor`. Loads `conductor.json`, builds providers via `provider-factory.ts`, wires the gateway. `src/main.ts` is the programmatic entry; `src/cli.ts` is the executable.                                                                                                                          |

### Request flow

1. **Boot** — `server/main.ts` loads + Zod-validates `conductor.json` (`ConductorConfigSchema`), `initTelemetry`, constructs a `ProviderRegistry` from `providers[]`, connects all providers, creates the audit store, calls `startGateway`.
2. **Wrap** — `gateway/mcp-app.ts` wraps every provider with `auditedProvider` (adds tracing spans + audit-store writes per `callTool`).
3. **Per-request** — `gateway/server.ts` receives HTTP; `mcp-app.handleRequest` authenticates (`extractBearer` + `verifyApiKey` — timing-safe `sha256` compare against `apiKeyHash`). Session reuse via `mcp-session-id` header; new sessions must be MCP `initialize` requests. Session data held in `SessionManager` (LRU cap = `server.maxSessions`).
4. **Build per session** — `buildMcpServer` resolves the user's reachable providers via `access-control.providersForUser` (groups → providers, `"*"` expands to all), then registers every tool under the namespaced name `"<provider>__<tool>"` (see `namespace.ts`). Input schema is passed through as `z.unknown()` per property — upstream is the source of truth for validation.
5. **Tool call** — MCP server handler decodes `provider__tool`, looks up the (audit-wrapped) provider, calls `provider.callTool(tool, args, { user, requestId, signal })`. Result content is flattened to MCP text parts.
6. **Shutdown** — `createShutdownRegistry` runs handlers LIFO: http-server → sessions → providers → audit → telemetry. The CLI owns signal handling.

### Key invariants

- **Provider names**: `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`, must not contain `__`. Enforced in `ProviderRegistry.register`.
- **Tool namespacing**: the gateway exposes `<provider>__<tool>`. `__` is reserved for the separator — don't introduce it elsewhere in names.
- **API keys**: stored as `sha256:<64-hex>`. Never put plaintext in config. Use `pnpm hash-key`.
- **Config schema is strict** (`.strict()` at the top level in `conductor-config.ts`) — unknown keys are rejected.
- **`ToolProvider` contract** (`core/src/providers/tool-provider.ts`): `connect`, `close`, `listTools`, `callTool(name, args, ctx)`. The gateway assumes providers honour `ctx.signal` for cancellation.
- **Audit writes are best-effort and out-of-band** — the audit wrapper records each call with duration, user, requestId, status, and redacted args. Don't move audit in front of the actual tool call.
- **Telemetry is a no-op without `OTEL_EXPORTER_OTLP_ENDPOINT`** — `initTelemetry` bails early. Don't add required OTel calls to hot paths.

### Config (`conductor.json`)

Defined by `packages/server/src/conductor-config.ts` (extends `GatewayConfigSchema` from the gateway package). Top-level: `server`, `users[]`, `groups[]`, `providers[]`, `audit`, `telemetry`. `providers[]` is a discriminated union on `type` — today only `"mcp"`, but the shape is kept as a union so adding `"openapi"`/`"graphql"`/`"openshell"` is a local change.

### Environment variables

| Var                           | Purpose                                               |
| ----------------------------- | ----------------------------------------------------- |
| `CONDUCTOR_CONFIG`            | Path to `conductor.json`. Default `./conductor.json`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP base URL. If unset, traces are disabled.    |

## Conventions

- **Module system**: ESM everywhere (`"type": "module"`), NodeNext resolution. Imports of local files MUST use the `.js` extension (TS compiles to ESM `.js`).
- **TS config**: `strict` + `noUncheckedIndexedAccess` at the base. Every package has two tsconfigs — `tsconfig.json` (`noEmit`, includes tests, used by `typecheck`) and `tsconfig.build.json` (emits to `dist/`, src only).
- **Runtime validation at boundaries**: Zod schemas for config + provider options (`McpProviderOptionsSchema` etc.). Internal interfaces are plain TS types.
- **Errors**: typed error classes in `core/src/errors` (`ConfigError`, `AuthError`, `ProviderError`, `SandboxError`). Throw these at the boundary; the gateway maps them to HTTP status codes.
- **Node**: `>=20.11`. pnpm `>=9`.

## Development plans

Implementation plans for larger work live in `docs/superpowers/plans/*.md` (e.g. `2026-04-24-provider-openshell.md`). When picking up unfinished work, read the matching plan first.
