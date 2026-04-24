# mcp-conductor

Tool gateway for AI agents. Speaks MCP to clients. Aggregates tools from multiple backends behind auth + group-based access control, with full audit.

Backends implement a common `ToolProvider` interface. Stage 1 ships a provider for:

- **MCP upstream servers** (stdio) — the default case

Planned (Stage 2): OpenAPI, GraphQL, HTTP tools, sandbox.

## Packages

- `@mcp-conductor/core` — foundation: logger, OTel, lifecycle, errors, `ToolProvider` interface, data-access interfaces, file-based stores
- `@mcp-conductor/provider-mcp` — MCP upstream adapter
- `@mcp-conductor/gateway` — HTTP MCP server, auth, group access, audit, consumes any `ToolProvider[]`
- `@mcp-conductor/server` — CLI binary + config wiring

## Dev

```bash
nvm use
pnpm install
pnpm build
pnpm test
```

## Quick Start

1. `pnpm install && pnpm build`
2. `pnpm hash-key my-secret-key` → copy the `sha256:...` output into `apiKeyHash`
3. Copy `examples/conductor.example.json` to `./conductor.json`, fill in hashes + upstream env
4. `pnpm dev` (runs `@mcp-conductor/server`) — gateway listens on port 3000
5. Connect via any MCP client: `Authorization: Bearer my-secret-key`, URL `http://localhost:3000/mcp`
