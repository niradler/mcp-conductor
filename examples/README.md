# Example configurations

Drop-in `conductor.json` files for common deployment shapes. Each is fully working — copy to the repo root or point `CONDUCTOR_CONFIG` at it.

| File | What it shows |
|---|---|
| `minimal.json` | Single user, single group, single provider. Simplest setup that exposes one upstream MCP server. |
| `multi-provider.json` | Three providers, three groups with different access scopes, `allow_tools` and `exclude_tools` filtering. |
| `conductor.json` | The original demo config used by `pnpm dev`. Keeps the hard-coded `changeme` key for convenience. |

## Running an example

```bash
# minimal: single provider, full access
CONDUCTOR_CONFIG=examples/minimal.json pnpm dev

# multi-provider: three users with different scopes
CONDUCTOR_CONFIG=examples/multi-provider.json pnpm dev
```

The gateway listens on `http://127.0.0.1:18080/mcp`. Authenticate with `Authorization: Bearer <plaintext>`.

## API keys in the examples

The example `apiKeyHash` values are sha256 hashes of placeholder plaintexts:

| File | User | Plaintext | Replace with |
|---|---|---|---|
| `minimal.json` | `alice` | `alice-please-rotate` | `pnpm hash-key <your-key>` |
| `multi-provider.json` | `alice` | `alice-please-rotate` | `pnpm hash-key <your-key>` |
| `multi-provider.json` | `bob` | `bob-please-rotate` | `pnpm hash-key <your-key>` |
| `multi-provider.json` | `carol` | `carol-please-rotate` | `pnpm hash-key <your-key>` |

These suffixes (`-please-rotate`) are intentional — they're not in the validator's known-weak-key list, so `conductor validate` won't flag them, but they're still placeholders. Generate real hashes for any non-local deployment.

## Validate before running

```bash
node packages/server/dist/cli.js validate examples/multi-provider.json
# or, with tsx during dev:
npx tsx packages/server/src/cli.ts validate examples/multi-provider.json
```

The validator checks schema, cross-references, and the providers' `command` paths. It exits non-zero on errors, making it CI-safe.

## Filtering tools per provider

`multi-provider.json` demonstrates two complementary filter modes:

- `filesystem` uses `allow_tools` — exposes only the read-side tools, so writes (`write_file`, `move_file`, `create_directory`, ...) are hidden from agents.
- `time` uses `exclude_tools: ["set_time"]` — keep everything but block one specific operation.

Both fields support glob patterns (`sandbox_*`). `exclude_tools` always wins when a tool matches both lists.

## Group-based access in multi-provider

| User | Groups | Sees |
|---|---|---|
| `alice` | `admins` | All providers (`["*"]`) |
| `bob` | `readers` | `filesystem`, `time` |
| `carol` | `readers`, `tools` | `filesystem`, `time`, `everything` (union of group provider lists) |

Membership is additive — a user gets the union of providers across all their groups.
