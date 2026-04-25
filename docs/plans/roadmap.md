# conductor Roadmap

Competitive reference: fiberplane/mcp-gateway, agentic-community/mcp-gateway-registry, AWS AgentCore Gateway.
Each stage is independently shippable. Stages are ordered by impact-to-effort ratio.

---

## Stage 1 — Core Correctness (current sprint)

These three items fix visible gaps that affect every agent talking to the gateway today.

### 1.1 Full JSON Schema passthrough (priority: critical)

**Problem:** `jsonSchemaToZodRawShape` in `packages/gateway/src/mcp-app.ts` emits `z.unknown()` for every property. Agents see flat untyped parameters — no types, no enums, no min/max, no required marking.

**Work:**
- Extract module-level `jsonSchemaPropertyToZod(schema)` recursive converter
- Handle: `string`, `number`, `integer` (with `.int()`), `boolean`, `null`, `array` (with `items`), `object` (nested, `.passthrough()`)
- Handle: `enum` → `z.enum()` / `z.literal()` union, `anyOf`/`oneOf` → `z.union()`
- Constraints: `minimum`/`maximum` → `.min()`/`.max()`, `minLength`/`maxLength`, `minItems`/`maxItems`, `pattern` → `.regex()`
- `required[]` array → mark non-listed fields `.optional()`
- `type: ["string", "null"]` → `.nullable()`
- Export function for unit testing; add `packages/gateway/tests/json-schema.test.ts`

**Done when:** `tools/list` response for any provider shows correct JSON Schema types, enums, and required fields. All existing tests still green.

---

### 1.2 `allow_tools` / `exclude_tools` per-provider filtering (priority: high)

**Problem:** No way to expose a subset of tools from a provider. A provider with 50 tools must expose all 50.

**Work:**
- Add optional `allow_tools?: string[]` and `exclude_tools?: string[]` to provider config in `packages/server/src/conductor-config.ts`
- Both fields support exact names and glob patterns (e.g., `"sandbox_*"`) using the `micromatch` package (already used elsewhere or add as dep)
- Apply filter in `buildMcpServer` after `provider.listTools()`, before `registerTool`:
  - If `allow_tools` defined: keep only matching tools
  - `exclude_tools` always removes matching tools (applied after allow)
- Filtering is provider-level (per entry in `providers[]`)
- Add tests in `packages/gateway/tests/` using the stub provider

**Done when:** Config with `allow_tools: ["echo"]` on the stub provider exposes only `stub__echo`; `exclude_tools: ["echo"]` hides it.

---

### 1.3 Meta-tools: `conductor__list_providers` + `conductor__list_tools` (priority: high)

**Problem:** Agents receive all tools from all providers in a single flat list. With 10+ providers this becomes unmanageable (100+ tools in one `tools/list` response). Agents can't discover what's available incrementally.

**Work:**
- Register two built-in tools in `buildMcpServer` before provider tools:
  - `conductor__list_providers` — returns JSON array of provider names accessible to the current user
  - `conductor__list_tools(provider: string)` — returns full tool listing (names, descriptions, JSON Schema) for one provider; errors if provider not accessible
- Both tools are registered unconditionally for every session
- `conductor__list_tools` reads from the already-fetched `provider.listTools()` result (no re-fetch per call)
- Add unit tests for both tools

**Done when:** An agent can call `conductor__list_providers` to see `["stub"]`, then `conductor__list_tools("stub")` to see `[{name: "echo", ...}]`, without needing to receive all tools upfront.

---

## Stage 2 — Developer Experience

### ~~2.1 Per-request audit requestId~~ ✅ DONE (2026-04-26)

**Problem:** All tool calls in a session shared the `requestId` from the `initialize` POST. Audit entries couldn't be correlated to individual HTTP requests.

**Implementation:** `mcp-app.ts` `handleRequest` now re-injects the per-request `X-Request-Id` (incoming or generated) back onto `req.headers` before delegating to the MCP transport. The MCP SDK's `StreamableHTTPServerTransport` exposes the request headers via `extra.requestInfo.headers` to tool handlers; the gateway's tool handler reads `x-request-id` from there per call, falling back to the closure-captured initialize-time id only if absent. Audit rows now carry distinct `requestId`s for each tool call within a session.

**Test:** `gateway-e2e.test.ts` "each tool call gets its own audit requestId" — connects one client, makes two `stub__echo` calls, asserts the two appended audit rows have distinct, truthy `requestId`s.

### 2.2 Resource proxying (`resources/read`) (priority: medium)

**Problem:** `resourceLink` content type returns URIs agents must follow up with `resources/read` — but the gateway doesn't proxy `resources/read` to upstream providers.

**Work:** Implement `resources/read` proxy in the gateway MCP server. Map resource URIs to the correct provider using a naming convention (e.g., URI prefix `mcp://{provider}/`).

### 2.3 Task-based tool support (priority: medium)

**Problem:** MCP SDK v1.29.0 introduced `taskSupport: "required"` tools that need `callToolStream()`. The gateway uses synchronous `registerTool` handlers.

**Work:** Detect tools with `taskSupport: "required"`, register via `registerToolTask`, use `client.experimental.tasks.callToolStream` in `UpstreamClient`.

### 2.4 Extended `/health` with per-provider status (priority: low)

**Problem:** `/health` returns provider names but no per-provider connectivity status.

**Work:** Add `providers: [{name, status: "connected"|"error", lastError?}]` to health response. `ProviderRegistry` tracks last connect/error state.

---

## Stage 2.5 — Provider Type Expansion

Today the only provider type is `mcp` (stdio upstream). To match the surface area of `api-spec-cli` (`C:\Projects\spec-cli`) — which lets agents call OpenAPI, GraphQL, and MCP endpoints — the gateway needs to grow new provider variants. Each variant slots into the existing discriminated union in `packages/server/src/conductor-config.ts` (`ProviderEntrySchema`) and ships as its own `@mcp-conductor/provider-*` package implementing `ToolProvider`.

The spec-cli surface to mirror:

```text
spec add <name> --openapi <url>
spec add <name> --graphql <url> --auth <token>
spec add <name> --mcp-http  <url> --auth <token>
spec add <name> --mcp-sse   <url>
spec add <name> --mcp-stdio "<cmd>"
```

Translating to `conductor.json` provider entries.

### 2.5.1 OpenAPI provider (priority: high)

**Problem:** Most internal APIs ship an OpenAPI spec but no MCP server. Today they're invisible to agents unless someone hand-writes a wrapper.

**Work:**

- New package `@mcp-conductor/provider-openapi` exporting `OpenApiProvider implements ToolProvider`.
- Config:

  ```json
  {
    "type": "openapi",
    "name": "petstore",
    "spec_url": "https://api.example.com/openapi.json",
    "base_url": "https://api.example.com",
    "auth": { "type": "bearer", "token_env": "PETSTORE_TOKEN" },
    "cache_ttl_seconds": 3600,
    "allow_tools": ["get_*"]
  }
  ```

- On `connect()`: fetch spec (URL or file path), validate via `@apidevtools/swagger-parser` or `openapi-types`, cache the parsed spec on disk at `~/.conductor/cache/<provider-name>.json` (matches spec-cli's `~/spec-cli-config/cache/`).
- Tool generation: each `(method, path, operation)` → one tool. Tool name = `operationId` (snake-cased) when present, fallback `<method>_<path>` (e.g., `get_pets_petId`).
- Tool input schema: union of `parameters[]` (path/query/header) + `requestBody.content["application/json"].schema`. Map to JSON Schema (already passthrough-capable after Stage 1.1).
- Tool execution: build the HTTP request from the operation, inject auth header, send via `undici` or native `fetch`, return response body as `text` content (or `json` content type when applicable).
- `$ref` resolution: dereference local + remote refs at spec-load time.
- Error mapping: 4xx/5xx responses → `isError: true` with structured detail.

**Done when:** `conductor.json` with an OpenAPI provider exposes one tool per operation; an agent can call `petstore__get_pets({ limit: 10 })` and get the live API response.

### 2.5.2 GraphQL provider (priority: high)

**Problem:** Same as OpenAPI but for GraphQL — introspection makes this almost free.

**Work:**

- New package `@mcp-conductor/provider-graphql` exporting `GraphqlProvider implements ToolProvider`.
- Config:

  ```json
  {
    "type": "graphql",
    "name": "github",
    "endpoint": "https://api.github.com/graphql",
    "auth": { "type": "bearer", "token_env": "GITHUB_TOKEN" },
    "expose": "queries"
  }
  ```

- On `connect()`: run `__schema` introspection query, cache result on disk.
- Tool generation strategies (configurable via `expose`):
  - `"queries"` — one tool per top-level Query field.
  - `"mutations"` — one tool per Mutation field.
  - `"both"` — both, prefixed with `query_` / `mutation_`.
  - `"raw"` — single tool `query(query: string, variables?: object)` that just forwards arbitrary GraphQL.
- Tool input schema: GraphQL field arguments → JSON Schema. Object / Input types are recursively converted; scalars map to standard types (`ID`/`String` → string, `Int` → integer, `Float` → number, `Boolean` → boolean, custom scalars → string with description).
- Tool execution: build a minimal GraphQL document for the field (selection set defaults to scalar fields; deep selection optional via `select` arg), POST to endpoint, return data.
- Selection-set strategy is the hard part — for v1, default to "all scalar fields one level deep" and let users opt-in to deeper selection via a `select` parameter on the tool itself.

**Done when:** Adding a GraphQL provider exposes each query as a tool; calling it returns real data.

### 2.5.3 OAuth / token auth on provider configs (priority: high)

**Problem:** spec-cli supports `--auth <token>` per spec; conductor has no per-provider auth concept.

**Work:**

- Shared `ProviderAuthSchema` discriminated union in `packages/server/src/conductor-config.ts`:

  ```ts
  type ProviderAuth =
    | { type: "none" }
    | { type: "bearer"; token?: string; token_env?: string }
    | { type: "basic"; username: string; password_env: string }
    | { type: "api_key"; header: string; value_env: string }
    | { type: "oauth2_client_credentials"; token_url: string; client_id: string; client_secret_env: string; scope?: string };
  ```

- `token_env` (read at startup) is the safe default — never put plaintext tokens in `conductor.json`.
- For `oauth2_client_credentials`: gateway fetches a token at provider connect time, caches it in memory with expiry, refreshes on 401 or before `exp - 60s`.
- Available on OpenAPI, GraphQL, and (new) HTTP/SSE MCP provider variants. Stdio MCP provider doesn't need it (auth is the upstream's problem).
- Reuse the same module for the future "Stage 4.1 OAuth ingress" work — same JWT verification primitives.

**Done when:** Any HTTP-shaped provider can be configured with `auth.type` and gets the right `Authorization` (or custom) header on every upstream call. Tokens are never logged.

### 2.5.4 MCP-HTTP / MCP-SSE transport variants (priority: medium)

**Problem:** `provider-mcp` only spawns stdio. Many MCP servers run as HTTP (Streamable HTTP) or SSE services — common for cloud-hosted MCP servers (Cloudflare, AgentCore, Composio).

**Work:**

- Extend `McpProviderOptionsSchema` (or split into a discriminated union by transport):

  ```json
  { "type": "mcp", "transport": "stdio", "command": "...", "args": [...] }
  { "type": "mcp", "transport": "http",  "url": "https://...", "auth": {...} }
  { "type": "mcp", "transport": "sse",   "url": "https://...", "auth": {...} }
  ```

- Use `StreamableHTTPClientTransport` / `SSEClientTransport` from `@modelcontextprotocol/sdk` instead of `StdioClientTransport`.
- Inject auth header from the shared `ProviderAuthSchema` (2.5.3) into the transport's `requestInit.headers`.
- Reconnect/backoff logic mirrors the existing stdio path.

**Done when:** A remote MCP server reachable over HTTP can be added with one config block; tools from it appear under `<provider>__<tool>` like any other.

### 2.5.5 Spec caching layer (priority: medium)

**Problem:** OpenAPI / GraphQL specs change. We don't want to refetch on every gateway boot, but we also don't want stale tools forever.

**Work:**

- Shared cache directory: `~/.conductor/cache/<provider-name>.json` (configurable via `cache_dir` in server config; matches spec-cli convention).
- Cache entry: `{ spec, fetchedAt, etag, lastModified }`.
- On boot, if cache age < `cache_ttl_seconds`, use it; else conditional refetch with `If-None-Match` / `If-Modified-Since`.
- `conductor refresh-spec <provider>` CLI command (new in DevEx D8) — force-refetch ignoring cache.
- `POST /admin/providers/{name}/refresh` — same, over HTTP (Stage 3.2 admin API).

**Done when:** Restarts are fast; refetching is one command; stale specs aren't a debugging trap.

---

## Stage 3 — Production Readiness

### 3.1 Docker / container packaging (priority: high)

**Work:**
- `Dockerfile` (multi-stage: build → slim runtime) at repo root
- `docker-compose.yml` for local dev (mounts `conductor.json` from host)
- `.dockerignore`
- GitHub Actions workflow: build + push to GHCR on tag

### 3.2 Admin REST API (priority: medium)

**Work:**
- `GET /admin/sessions` — list active sessions (id, user, createdAt)
- `DELETE /admin/sessions/{id}` — forcibly close a session
- `GET /admin/providers` — list providers with status
- `POST /admin/providers/{name}/reconnect` — trigger reconnect
- Auth: same bearer token, but gate on a `admin: true` flag in user config

### 3.3 Web dashboard (priority: medium)

**Work:**
- Minimal React UI served from `/ui`
- Pages: Sessions, Providers, Audit log
- Powers via Admin REST API
- Fiberplane's approach (traffic capture + log browser) is the reference

---

## Stage 4 — Enterprise Features

### 4.1 OAuth 2.0 / OIDC authentication (priority: high for enterprise)

**Problem:** Only static bearer tokens. Enterprises need SSO.

**Work:**
- Add `auth.oidc` config block: `issuer`, `clientId`, `audience`, `jwksUri`
- Validate JWT on each request (verify signature, expiry, audience)
- Map JWT `sub` or custom claim → user in `users[]`, or auto-provision from OIDC groups
- Reference: agentic-community uses Keycloak + Entra ID + Cognito

### 4.2 Per-group tool allow/exclude lists (priority: medium)

**Problem:** Tool filtering is per-provider only. Groups can't see different tool subsets from the same provider.

**Work:** Add `allow_tools`/`exclude_tools` to group config. Merge with provider-level filter (group filter applied after provider filter).

### 4.3 Dynamic provider registration (priority: medium)

**Problem:** Adding a provider requires restart.

**Work:**
- `POST /admin/providers` — register a new provider at runtime
- `DELETE /admin/providers/{name}` — disconnect and remove
- Sessions created after the change see the new provider list; existing sessions are unaffected

### 4.4 Semantic tool search / discovery (priority: medium)

**Problem:** With many providers, agents can't efficiently find the right tool without seeing all 100+.

**Work:**
- `conductor__search_tools(query: string)` meta-tool — fuzzy-matches tool names + descriptions
- Optional: embed descriptions with a local model (e.g., `@xenova/transformers`) for vector search
- For v1: simple keyword/substring match is sufficient

---

## Security Roadmap

Security is first-class, not an afterthought. Items below are ordered by risk impact.

### ~~S1 — Input validation hardening~~ ✅ DONE (2026-04-25)

**Current state:** Tool arguments are forwarded to upstream MCP servers with Zod validation but no sanitization. The gateway trusts the upstream schema.

**Implemented:**

- ✅ `server.maxArgSizeBytes` (default 1 MB) — `Content-Length` is checked before authentication, rejecting oversized payloads with 413 + `request/too_large`. Implementation in `mcp-app.ts` `handleRequest`.
- ✅ `conductor__list_tools` provider arg — already gated implicitly: `providerTools` only contains entries for the user's allowed providers, so an unknown name returns `isError: true` with a message listing the allowed set. No upstream call made.
- ✅ `server.maxCallsPerMinute` (default 0 = unlimited) — per-session minute-window limiter (`packages/gateway/src/rate-limit.ts`). Applied to every existing-session HTTP request; exceeding returns 429 + `rate_limited`. Bucket cleared on session close. 5 unit tests + e2e oversized-body assertion.

### S2 — API key security (priority: high, stage 1/2)

**Current state:** API keys stored as `sha256:<hex>`. No expiry, no rotation support.

**Work:**

- Add optional `expiresAt` (ISO date) to user config. Gateway rejects expired keys at auth time.
- Add `GET /admin/keys/rotate` endpoint that returns a new hash for the same user (requires existing valid key).
- Consider supporting multiple `apiKeyHashes` per user (enables zero-downtime rotation — add new, remove old after all clients migrate).

### S3 — Transport security (priority: high, stage 3)

**Current state:** Gateway binds plain HTTP. TLS must be provided by a reverse proxy.

**Work:**

- Add `tls` block to server config: `{ certFile, keyFile }`. Gateway serves HTTPS directly when configured.
- Document the reverse-proxy pattern (nginx, Caddy) as the recommended production deployment.
- Enforce `Strict-Transport-Security` header when TLS is active.

### ~~S4 — Tool argument redaction in audit~~ ✅ DONE (2026-04-25)

**Implementation:**

- `redact_fields?: string[]` added to `McpProviderEntrySchema` in `packages/server/src/conductor-config.ts`. Per-provider extra keys, applied case-insensitively in addition to the built-in sensitive-key regex (password/secret/token/api_key/etc.).
- `StartGatewayOptions.redactKeysForProvider?: (name) => string[]` and `ExportMcpAppDeps.redactKeysForProvider` callback. Plumbed in `gateway/src/server.ts` and `mcp-app.ts`; the wrap loop forwards `redactExtraKeys` to `auditedProvider` per provider when the callback returns a non-empty list.
- `server/main.ts` builds a `Map<string, string[]>` from config entries and passes the lookup callback to `startGateway`.
- Test coverage: new unit test in `packages/gateway/tests/audit-wrapper.test.ts` ("redactExtraKeys redacts non-sensitive-named fields") verifies that non-sensitive-named arg keys (e.g. `repo_url`, `tenant_id`) are redacted in the persisted audit row.
- Constraint: end-to-end demos against MCP servers whose tool schemas declare `additionalProperties: false` (e.g. the `everything` server) won't reach the redactor — the upstream rejects the extra field before the call lands. To exercise `redact_fields` end-to-end, point at a provider whose tool accepts the field as part of its schema.
- Deferred to a future change: structured audit output to file/SIEM (separate work — `audit.type: "console"` is the only sink today).

### S5 — Mutual TLS / certificate-pinned upstream connections (priority: medium, stage 4)

**Problem:** Upstream MCP servers (stdio today) don't use mTLS. When HTTP upstream providers are added, man-in-the-middle is a risk.

**Work:** When HTTP providers are added, support `tls: { ca, cert, key }` in provider config for mTLS to upstream.

### S6 — OAuth 2.0 / OIDC (priority: high, stage 4)

See Stage 4.1. Key security properties:

- JWT signature verification (RS256/ES256) against issuer JWKS
- Audience check (`aud` claim must match configured audience)
- Expiry check (`exp` claim)
- Optional: PKCE enforcement for interactive flows
- Service account support: M2M via client credentials grant

### S7 — Secrets management integration (priority: medium, stage 4)

**Problem:** Provider `env` fields in `conductor.json` may contain secrets (API keys, tokens). Storing secrets in plain JSON is a risk.

**Work:**

- Add `env_from_secret` field to provider config: `{ VAR_NAME: "vault://path/to/secret" }`.
- Implement a `SecretResolver` interface with a Vault backend (HashiCorp Vault, AWS Secrets Manager via environment injection).

---

## Developer Experience (DevEx) Roadmap

DevEx items reduce friction for developers integrating with or operating conductor.

### D1 — Hot config reload (priority: high, stage 3)

**Problem:** Every config change requires a full restart, dropping all active sessions.

**Work:**

- Watch `conductor.json` for changes via `fs.watch`.
- On change: re-validate config, diff providers, connect new providers, disconnect removed ones. Existing sessions are unaffected until they reinitialize.
- Log which providers were added/removed.

### D2 — `conductor explain-tool <provider> <tool>` CLI command (priority: medium, stage 3)

Developer command that connects to a running gateway, calls `conductor__list_tools`, and pretty-prints a specific tool's schema with examples. Helps debug provider configuration without writing a client.

### ~~D3 — Structured error responses~~ ✅ DONE (2026-04-25)

**Problem:** Gateway errors (auth failures, provider errors) return plain text or minimal JSON. Clients can't reliably parse error details.

**Implemented in:** `packages/gateway/src/errors.ts` (helpers `buildGatewayError`, `writeErrorResponse`; `GatewayErrorCode` enum). All HTTP-level gateway errors now use `{ error: { code, message, details? } }`. Codes shipped: `auth/unauthorized` (401), `not_found` (404), `internal_error` (500), `bad_request` (reserved). Updated: 401 auth (mcp-app.ts), 404 fall-through (Hono notFound), 500 catch-all (server.ts). MCP-level JSON-RPC errors (`-32000 Bad Request: Server not initialized`) intentionally left in JSON-RPC format — that's protocol-level. Future codes (`provider/unavailable`, `tool/not_found`, `tool/call_failed`) will be added when those error paths surface explicitly. 4 unit tests in `errors.test.ts` + e2e assertions for 401/404 shape.

### D4 — OpenAPI spec for admin API (priority: medium, stage 3)

Generate and serve `GET /openapi.json` for the admin REST API. Enables client generation, Postman collection, and Swagger UI.

### D5 — Provider connection status events (priority: low, stage 3)

Expose a `GET /admin/events` SSE stream that emits: provider connected, provider disconnected, session created, session expired. Enables operator dashboards and alerting without polling.

### ~~D6 — `conductor validate` CLI command~~ ✅ DONE (2026-04-25)

Validate a `conductor.json` file offline (without starting the server): parse config, check provider commands exist on disk, warn about weak API keys. Useful in CI before deployment.

**Implemented in:** `packages/server/src/validate.ts` + `cli.ts` `validate [path]` subcommand. Errors: schema, cross-refs (user→group, group→provider), duplicate provider names. Warnings: command not on PATH, well-known weak API keys, `audit=console`, `host=0.0.0.0`, allow/exclude overlap. Exit 0 on success, 1 on errors. 14 tests in `packages/server/tests/validate.test.ts`.

### D7 — Example configs and quick-start guide (priority: high, stage 2)

`examples/` directory with:

- ✅ `minimal.json` — single provider, single user — DONE (2026-04-25)
- ✅ `multi-provider.json` — 3 providers, 3 user groups, `allow_tools` + `exclude_tools` filter example — DONE (2026-04-25)
- ✅ `examples/README.md` — quick-start guide explaining each shape, how to validate, and how filters compose — DONE (2026-04-25)
- ⏳ `enterprise.json` — OIDC auth, TLS, audit to file, redact_fields — deferred until OIDC (Stage 4) and structured audit (S4) land
- ⏳ `docker-compose.yml` — conductor + everything provider, ready to run — deferred to Stage 3 (Docker packaging)

Regression test in `packages/server/tests/validate.test.ts` runs the validator against all shipped examples.

---

## Stage 5 — Advanced / Ecosystem

### 5.1 External tool registry integration (priority: low)

Import tool definitions from Anthropic MCP Registry or similar. Conductor becomes a discovery hub, not just a proxy.

### 5.2 Federation (priority: low)

Sync provider/tool lists across multiple conductor instances. Reference: agentic-community's peer-to-peer federation with bidirectional sync.

### 5.3 Agent registry / A2A (priority: low)

Register AI agents and enable agent-to-agent discovery. Reference: agentic-community's A2A support with the A2A protocol.

### 5.4 MCP server version routing (priority: low)

Run multiple versions of the same upstream MCP server behind one provider name. Support version pinning, rollback, deprecation lifecycle.

---

## Competitive gap summary (as of 2026-04-25)

| Capability | conductor | Fiberplane | Agentic |
|---|---|---|---|
| Multi-provider aggregation | ✅ | ✅ | ✅ |
| Bearer token auth | ✅ | ✅ | ✅ |
| Group-based access control | ✅ | ❌ | ✅ |
| Audit logging | ✅ | ✅ (SQLite) | ✅ (Mongo) |
| OTel tracing | ✅ | ❌ | partial |
| JSON Schema passthrough | ❌ (stage 1) | n/a | ✅ |
| Tool-level allow/exclude | ❌ (stage 1) | ❌ | ✅ |
| Meta-tools (lazy discovery) | ❌ (stage 1) | ❌ | ✅ |
| Docker support | ❌ (stage 3) | ✅ | ✅ |
| Web dashboard | ❌ (stage 3) | ✅ | ✅ |
| OAuth / OIDC | ❌ (stage 4) | ❌ | ✅ |
| Semantic tool search | ❌ (stage 4/5) | ❌ | ✅ |
| Federation | ❌ (stage 5) | ❌ | ✅ |
| A2A / agent registry | ❌ (stage 5) | ❌ | ✅ |
| Traffic capture / replay | ❌ | ✅ | ❌ |
| OpenShell (gRPC) provider | ✅ | ❌ | ❌ |
