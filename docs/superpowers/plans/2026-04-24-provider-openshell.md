# Provider-OpenShell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Supersedes:** `2026-04-24-sandbox-executor.md` (Deno + shell executor; kept for history, not for execution).

**Goal:** Ship `@mcp-conductor/provider-openshell` — a `ToolProvider` that talks directly to the [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) gateway **gRPC API**. No CLI wrapping, no subprocesses. The gateway exposes two gRPC services (`openshell.v1.OpenShell` and `openshell.inference.v1.Inference`) on a single HTTP/2 port (default `8080`), with optional TLS / mTLS auth. Our provider is a thin, type-safe translation layer between MCP tool calls and those RPCs.

**Architecture:**
- One package, one class — `OpenShellProvider` implementing `ToolProvider`.
- `OpenShellClient` — a typed gRPC client built on `@grpc/grpc-js` + `@grpc/proto-loader`, loading the vendored `openshell.proto` / `sandbox.proto` / `datamodel.proto` files at runtime. Exposes only the RPCs we actually call (Health, CreateSandbox, GetSandbox, ListSandboxes, DeleteSandbox, ExecSandbox, GetSandboxLogs, UpdateConfig, GetSandboxPolicyStatus). Owns channel credentials (insecure / TLS / mTLS) and deadlines.
- Tools (MCP names): `sandbox_create`, `sandbox_get`, `sandbox_list`, `sandbox_destroy`, `sandbox_exec`, `sandbox_logs`, `policy_set`, `policy_status`.
- `connect()` opens the gRPC channel and calls `Health`. On any failure we throw `ProviderError` — the gateway never gets a half-alive provider.
- Every call routes through the gateway's audit path because the mcp-conductor gateway wraps `callTool` — this provider does not audit itself.

**Sandbox-provider family:** First concrete backend. Future packages (e.g. `@mcp-conductor/provider-sandbox-deno`, `@mcp-conductor/provider-e2b`, `@mcp-conductor/provider-modal`) each implement `ToolProvider` independently. There is no shared "sandbox core" package — `ToolProvider` in `@mcp-conductor/core` is the only shared abstraction, same pattern as `provider-mcp`.

**Tech Stack:** Node.js 20 LTS, TypeScript, `@mcp-conductor/core` (peer), `@grpc/grpc-js`, `@grpc/proto-loader`, `zod`. Host prerequisite: a running OpenShell gateway reachable at the configured endpoint. No OpenShell CLI needed on the mcp-conductor host; no Docker needed on the mcp-conductor host (Docker is an OpenShell-gateway concern, not ours).

**Design choices vs subprocess/CLI approach:**

1. **gRPC over HTTP/2 directly — no `child_process.spawn`.** OpenShell ships a stable protobuf contract (`proto/openshell.proto`). Wrapping the `openshell` CLI would re-parse text output that's already available as typed messages, and create an install-time dependency on a Rust/Python CLI that our Node host doesn't need. Talking gRPC is cheaper, stricter, and survives CLI UX changes.
2. **Native gRPC semantics preserved in tool surface.** `sandbox_exec` is a server-streaming RPC returning `ExecSandboxEvent { oneof stdout | stderr | exit }` — we consume the stream, aggregate stdout/stderr, surface exit code. We do not invent a universal `run_code` abstraction; other sandbox providers will expose their own native shapes.
3. **Vendor the `.proto` files.** `proto/openshell.proto`, `proto/sandbox.proto`, `proto/datamodel.proto`, plus `google/protobuf/struct.proto` from `@grpc/proto-loader`'s bundled includes. A pinned `PROTO_VERSION.md` records the upstream commit we pinned against. Bumps are explicit PRs.
4. **Three auth modes, zero in the middle.** `{ mode: "insecure" }` (dev / trusted network), `{ mode: "tls", ca: ... }` (server auth only — works with `--disable-gateway-auth` on the gateway), `{ mode: "mtls", ca, cert, key }` (full mTLS — the production mode). PEM material accepted as filesystem paths OR inline `Buffer`/`string`.
5. **No policy YAML parsing.** `policy_set` accepts a structured `SandboxPolicy`-shaped object validated by a zod schema that mirrors the proto. We do not import YAML. Callers who start from YAML can parse it themselves — the gateway itself also accepts structured input, so there's no loss of functionality and one fewer attack surface.
6. **No audit writes inside the provider.** Gateway owns audit.
7. **`connect()` fails loudly.** A `Health` RPC that times out or returns non-`SERVING` throws `ProviderError`. No degraded mode.

---

## File Structure

```text
packages/provider-openshell/
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
  README.md
  PROTO_VERSION.md                      # upstream commit/sha pinned for the vendored protos
  proto/
    openshell.proto                     # vendored from NVIDIA/OpenShell
    sandbox.proto
    datamodel.proto
  src/
    index.ts                            # barrel
    openshell-provider.ts               # OpenShellProvider class (implements ToolProvider)
    openshell-client.ts                 # OpenShellClient — @grpc/grpc-js channel + typed RPC methods
    proto-loader.ts                     # loads vendored .proto files into a typed client constructor
    credentials.ts                      # insecure / tls / mtls → grpc.ChannelCredentials
    config.ts                           # Zod schemas for OpenShellProviderOptions (endpoint, tls, timeouts, policy)
    types.ts                            # Zod schemas mirroring proto messages we send/receive
    tools/
      specs.ts                          # ToolSpec constants (JSON Schemas for MCP)
      sandbox-create.ts
      sandbox-get.ts
      sandbox-list.ts
      sandbox-destroy.ts
      sandbox-exec.ts
      sandbox-logs.ts
      policy-set.ts
      policy-status.ts
  tests/
    credentials.test.ts
    config.test.ts
    openshell-client.test.ts            # unit: mocked proto-loader output
    openshell-provider.test.ts          # unit: ToolProvider contract w/ mocked OpenShellClient
    integration/
      lifecycle.test.ts                 # real gateway; gated by VITEST_INTEGRATION=1
      exec.test.ts
      policy.test.ts
```

**Dependencies declared in `package.json`:**
- `peerDependencies`: `@mcp-conductor/core: workspace:*`
- `devDependencies`: `@mcp-conductor/core: workspace:*`
- `dependencies`: `@grpc/grpc-js`, `@grpc/proto-loader`, `zod`

**Packaging:** `proto/` is shipped in the published tarball (`files: ["dist", "proto", "README.md", "PROTO_VERSION.md"]`) so runtime loading finds them relative to `dist/`.

---

## Task 0: Proto Update Script + First Vendor + Connectivity Smoke Test

Locks in the proto surface **via a repeatable script** (not by hand), then smoke-tests connectivity to a real OpenShell gateway before any client code is written. Future upstream bumps are a one-command operation.

**Files:** `scripts/update-openshell-protos.ts`, root `package.json` (add pnpm entry), `packages/provider-openshell/proto/*.proto`, `packages/provider-openshell/PROTO_VERSION.md`

### Step 0.1 — Write the update script

`scripts/update-openshell-protos.ts` — follows the existing `scripts/hash-api-key.ts` pattern (plain TS, run via `tsx`, no extra deps). Uses Node 20's built-in `fetch` and GitHub's `raw.githubusercontent.com` for the proto bytes plus `api.github.com/repos/.../commits/<sha>` to resolve partial SHAs into full SHAs and to validate that the commit exists:

```typescript
// scripts/update-openshell-protos.ts
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO = "NVIDIA/OpenShell";
const PROTOS = ["openshell.proto", "sandbox.proto", "datamodel.proto"] as const;
const PROTO_DIR = "packages/provider-openshell/proto";
const VERSION_FILE = "packages/provider-openshell/PROTO_VERSION.md";

async function main(): Promise<void> {
  let sha = process.argv[2];

  if (!sha) {
    const existing = await readFile(VERSION_FILE, "utf8").catch(() => "");
    const match = existing.match(/\*\*Pinned commit:\*\*\s+`([a-f0-9]{7,40})`/);
    sha = match?.[1];
    if (!sha) {
      console.error("usage: pnpm update-openshell-protos <commit-sha>");
      console.error("  (or have a pinned SHA already in PROTO_VERSION.md to re-fetch it)");
      process.exit(1);
    }
    console.log(`using pinned SHA from ${VERSION_FILE}: ${sha}`);
  }

  // Resolve partial SHAs and verify the commit exists.
  const commitRes = await fetch(`https://api.github.com/repos/${REPO}/commits/${sha}`);
  if (!commitRes.ok) {
    console.error(`commit ${sha} not found on ${REPO}: ${commitRes.status} ${commitRes.statusText}`);
    process.exit(1);
  }
  const commit = await commitRes.json() as {
    sha: string;
    commit: { message: string; author: { date: string } };
  };
  const fullSha = commit.sha;
  const subject = commit.commit.message.split("\n", 1)[0] ?? "";
  const date = commit.commit.author.date.slice(0, 10);

  await mkdir(PROTO_DIR, { recursive: true });
  for (const name of PROTOS) {
    const url = `https://raw.githubusercontent.com/${REPO}/${fullSha}/proto/${name}`;
    console.log(`fetching ${name}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`failed to fetch ${name} (${res.status} ${res.statusText}): ${url}`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(join(PROTO_DIR, name), buf);
  }

  const body = `# Vendored Proto Versions

Protos in \`packages/provider-openshell/proto/\` are vendored from [NVIDIA/OpenShell](https://github.com/${REPO}).
**Do not edit by hand** — run the update script instead.

**Pinned commit:** \`${fullSha}\`
**Commit date:** ${date}
**Commit subject:** ${subject}

## Files

${PROTOS.map((p) => `- \`${p}\``).join("\n")}

## Update

\`\`\`bash
pnpm update-openshell-protos <new-commit-sha>   # pin to a new upstream commit
pnpm update-openshell-protos                    # re-fetch the currently pinned commit
\`\`\`

The script verifies the commit on GitHub, downloads the three proto files from
\`raw.githubusercontent.com\`, writes them into the proto directory, and rewrites
this file. After any update run:

\`\`\`bash
pnpm -F @mcp-conductor/provider-openshell test
\`\`\`

Any breakage is a signal that upstream changed a message shape we depend on —
address it explicitly (schema bump, new field handling) in the same PR.
`;
  await writeFile(VERSION_FILE, body);
  console.log(`\npinned to ${fullSha.slice(0, 12)} (${date}) — ${subject}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Add the pnpm entry to root `package.json` (mirrors existing `hash-key`):

```json
"scripts": {
  "...": "...",
  "update-openshell-protos": "tsx scripts/update-openshell-protos.ts"
}
```

### Step 0.2 — First run: vendor the protos

- [ ] **Step 1:** Pick an upstream commit SHA (`gh api repos/NVIDIA/OpenShell/commits/main --jq '.sha'` to grab the latest on main, or pick a specific tagged release).
- [ ] **Step 2:** Run `pnpm update-openshell-protos <SHA>` from the repo root. The script writes the three protos and `PROTO_VERSION.md` in one shot.
- [ ] **Step 3:** `git status` — confirm the four expected files (`proto/openshell.proto`, `proto/sandbox.proto`, `proto/datamodel.proto`, `PROTO_VERSION.md`) show up; nothing else.

Note on `google/protobuf/struct.proto`: it's imported by `openshell.proto` but is provided by `@grpc/proto-loader`'s bundled `google-proto-files` in its own `includeDirs`. We don't vendor it. The `proto-loader` call in Task 4 passes our `PROTO_DIR` as an include path; `google-proto-files` resolves via proto-loader's defaults. If loading fails with `google/protobuf/struct.proto: file not found`, add `require.resolve("google-proto-files")`'s parent to `includeDirs` — document the fix in Task 4 if it comes up.

### Step 0.3 — Gateway smoke test

- [x] **Step 1:** Boot a local OpenShell gateway. **Only option (a) works** — `openshell gateway start` brings up the K3s-in-Docker stack with mTLS on by default. The previously-documented option (b) (`openshell-server --disable-tls ...`) does **not** work: the standalone `openshell-server` binary still requires a K8s driver at boot and will exit. Install on Linux/WSL via `uv tool install openshell` (requires glibc ≥ 2.39 for prebuilt wheels; on older glibc fall back to `pipx install openshell`). Endpoint: `https://127.0.0.1:8080` with self-signed certs under `~/.openshell/certs/`. Windows hosts: run inside WSL — there is no Windows wheel.

- [x] **Step 2:** Smoke-test connectivity. `openshell status -vv` is the canonical proof-of-life: it drives the same TLS-mTLS-HTTP/2-gRPC path our client will, exercises the client cert auth the gateway actually requires, and returns the server's `version` field. Captured on 2026-04-24 against the pinned proto commit:

  ```text
  TCP connect 127.0.0.1:8080 → TLS1.3 (TLS13_AES_256_GCM_SHA384) with client-cert auth
    → ALPN "h2" → HTTP/2 settings exchange
    → one gRPC stream (StreamId 1) opened/closed cleanly
  Status:  Connected
  Version: 0.0.36
  ```

  `grpcurl` was **not** used: `openshell status -vv` is strictly stronger evidence (mTLS vs. `-insecure`), and the "do our vendored protos match the server surface?" question is validated end-to-end through `@grpc/proto-loader` in Tasks 1–10 (unit tests fail loudly on proto/service mismatch before any integration test runs). If `grpcurl` is later needed for ad-hoc debugging, install via `.deb` from <https://github.com/fullstorydev/grpcurl/releases> (Ubuntu 22.04 has no apt package) or `go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest`.

- [x] **Step 3:** Committed in `21c4600` (also bundled SUPERSEDED banner on `2026-04-24-sandbox-executor.md` and cross-ref update in `2026-04-24-server.md`).

---

## Task 1: Package Skeleton

**Files:** `packages/provider-openshell/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,src/index.ts}`

- [x] **Step 1:** `packages/provider-openshell/package.json`

```json
{
  "name": "@mcp-conductor/provider-openshell",
  "version": "0.1.0",
  "description": "ToolProvider for NVIDIA OpenShell — sandbox lifecycle, exec, and policy via the OpenShell gRPC gateway",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "proto", "README.md", "PROTO_VERSION.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@mcp-conductor/core": "workspace:*"
  },
  "dependencies": {
    "@grpc/grpc-js": "^1.11.0",
    "@grpc/proto-loader": "^0.7.13",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@mcp-conductor/core": "workspace:*"
  }
}
```

- [x] **Step 2:** `packages/provider-openshell/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "rootDir": "." },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [x] **Step 3:** `packages/provider-openshell/tsconfig.build.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src", "tsBuildInfoFile": ".tsbuildinfo" },
  "include": ["src/**/*"]
}
```

- [x] **Step 4:** `packages/provider-openshell/vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

const runIntegration = process.env.VITEST_INTEGRATION === "1";

export default defineConfig({
  test: {
    name: "provider-openshell",
    include: ["tests/**/*.test.ts"],
    exclude: runIntegration ? [] : ["tests/integration/**"],
    testTimeout: runIntegration ? 120_000 : 15_000,
    environment: "node",
    clearMocks: true,
  },
});
```

- [x] **Step 5:** `packages/provider-openshell/src/index.ts` placeholder:

```typescript
export const VERSION = "0.1.0";
```

- [x] **Step 6:** `pnpm install` from repo root — `+1` workspace project added, all 6 resolve clean. `pnpm -F @mcp-conductor/provider-openshell typecheck` passes; `build` emits `dist/index.{js,d.ts,js.map,d.ts.map}`.

- [x] **Step 7:** Commit — see commit below.

---

## Task 2: Credentials Builder

Maps our three-mode config to `grpc.ChannelCredentials`. Pure function, easy to unit-test with real cert material.

**Files:** `packages/provider-openshell/src/credentials.ts`, `packages/provider-openshell/tests/credentials.test.ts`

- [ ] **Step 1:** Failing tests

```typescript
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildChannelCredentials } from "../src/credentials.js";

const FIXTURES = join(__dirname, "fixtures");

describe("buildChannelCredentials", () => {
  test("insecure mode returns insecure credentials", () => {
    const creds = buildChannelCredentials({ mode: "insecure" });
    expect(creds._isSecure()).toBe(false);
  });

  test("tls mode with CA buffer returns secure credentials", () => {
    const ca = readFileSync(join(FIXTURES, "ca.pem"));
    const creds = buildChannelCredentials({ mode: "tls", ca });
    expect(creds._isSecure()).toBe(true);
  });

  test("tls mode with CA path reads the file", () => {
    const creds = buildChannelCredentials({ mode: "tls", ca: join(FIXTURES, "ca.pem") });
    expect(creds._isSecure()).toBe(true);
  });

  test("mtls mode requires all three PEMs", () => {
    expect(() => buildChannelCredentials({ mode: "mtls", ca: join(FIXTURES, "ca.pem"), cert: join(FIXTURES, "client.pem") } as never))
      .toThrow(/key/);
  });

  test("mtls mode with ca+cert+key returns secure credentials", () => {
    const creds = buildChannelCredentials({
      mode: "mtls",
      ca: join(FIXTURES, "ca.pem"),
      cert: join(FIXTURES, "client.pem"),
      key: join(FIXTURES, "client.key"),
    });
    expect(creds._isSecure()).toBe(true);
  });
});
```

Generate the three PEM fixtures under `tests/fixtures/` once (self-signed test material) — document with a README in that folder. Check in the generated files; they're test-only.

- [ ] **Step 2:** Impl

```typescript
import { readFileSync } from "node:fs";
import * as grpc from "@grpc/grpc-js";

export type TlsOptions =
  | { mode: "insecure" }
  | { mode: "tls"; ca: string | Buffer }
  | { mode: "mtls"; ca: string | Buffer; cert: string | Buffer; key: string | Buffer };

function toBuffer(input: string | Buffer): Buffer {
  if (Buffer.isBuffer(input)) return input;
  // If it looks like inline PEM, use as-is; otherwise treat as a filesystem path.
  if (input.includes("-----BEGIN")) return Buffer.from(input, "utf8");
  return readFileSync(input);
}

export function buildChannelCredentials(tls: TlsOptions): grpc.ChannelCredentials {
  if (tls.mode === "insecure") return grpc.credentials.createInsecure();
  if (tls.mode === "tls") return grpc.credentials.createSsl(toBuffer(tls.ca));
  if (tls.mode === "mtls") {
    return grpc.credentials.createSsl(toBuffer(tls.ca), toBuffer(tls.key), toBuffer(tls.cert));
  }
  throw new Error(`unknown tls mode: ${(tls as { mode: string }).mode}`);
}
```

- [ ] **Step 3:** Run tests → green.

- [ ] **Step 4:** Commit.

---

## Task 3: Config Schema

**Files:** `packages/provider-openshell/src/config.ts`, `packages/provider-openshell/tests/config.test.ts`

- [ ] **Step 1:** `src/config.ts`

```typescript
import { z } from "zod";

const PemSource = z.union([z.string().min(1), z.instanceof(Buffer)]);

const TlsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("insecure") }),
  z.object({ mode: z.literal("tls"), ca: PemSource }),
  z.object({ mode: z.literal("mtls"), ca: PemSource, cert: PemSource, key: PemSource }),
]);

const TimeoutsSchema = z.object({
  connect: z.number().int().positive().default(15_000),
  create: z.number().int().positive().default(120_000),
  destroy: z.number().int().positive().default(60_000),
  exec: z.number().int().positive().default(120_000),
  list: z.number().int().positive().default(15_000),
  get: z.number().int().positive().default(15_000),
  logs: z.number().int().positive().default(15_000),
  policySet: z.number().int().positive().default(60_000),
  policyStatus: z.number().int().positive().default(15_000),
}).default({});

export const OpenShellProviderOptionsSchema = z.object({
  name: z.string().default("openshell"),
  endpoint: z.string().min(1),                       // "host:port", required
  tls: TlsSchema.default({ mode: "insecure" }),
  timeouts: TimeoutsSchema,
  /** Pattern applied client-side before RPC. Server validates too; this is defense in depth + fast-fail UX. */
  sandboxNamePattern: z.string().default("^[a-zA-Z0-9_-]{1,64}$"),
}).strict();

export type OpenShellProviderOptions = z.infer<typeof OpenShellProviderOptionsSchema>;
export type TlsOptions = z.infer<typeof TlsSchema>;
```

- [ ] **Step 2:** Tests — accept minimal (`{ endpoint: "x:1" }`), accept full with mtls, reject unknown keys, reject missing `endpoint`, reject negative timeouts, reject mtls without cert+key.

- [ ] **Step 3:** Run tests → green.

- [ ] **Step 4:** Commit.

---

## Task 4: Proto Loader + `OpenShellClient` (gRPC wrapper)

Central entry point. Loads vendored .proto files and exposes typed RPC methods we actually use. Handles deadlines from our per-tool timeouts.

**Files:** `packages/provider-openshell/src/proto-loader.ts`, `packages/provider-openshell/src/openshell-client.ts`, tests

### Step 1 — `proto-loader.ts`

```typescript
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as protoLoader from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";

// Resolve the vendored proto directory relative to this file, both in `src/` (tests) and `dist/` (prod).
const HERE = dirname(fileURLToPath(import.meta.url));
// dist/proto-loader.js → ../proto  |  src/proto-loader.ts (ts-node/vitest) → ../proto
const PROTO_DIR = join(HERE, "..", "proto");

export interface LoadedProto {
  OpenShellService: grpc.ServiceClientConstructor;
}

let cached: LoadedProto | undefined;

export function loadProto(): LoadedProto {
  if (cached) return cached;
  const pkgDef = protoLoader.loadSync(
    [join(PROTO_DIR, "openshell.proto"), join(PROTO_DIR, "sandbox.proto"), join(PROTO_DIR, "datamodel.proto")],
    {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    },
  );
  const grpcPkg = grpc.loadPackageDefinition(pkgDef) as unknown as {
    openshell: { v1: { OpenShell: grpc.ServiceClientConstructor } };
  };
  cached = { OpenShellService: grpcPkg.openshell.v1.OpenShell };
  return cached;
}
```

### Step 2 — `openshell-client.ts`

Design:
- Constructor takes `{ endpoint, credentials, timeouts }`.
- Each method wraps a single gRPC call with per-RPC `deadline` built from `Date.now() + timeoutMs`.
- `health()`, `createSandbox()`, `getSandbox()`, `listSandboxes()`, `deleteSandbox()`, `getSandboxLogs()`, `updateConfig()`, `getSandboxPolicyStatus()` — all unary, return promises.
- `execSandbox({ ..., signal })` — server-streaming. Returns `{ stdout: Buffer[], stderr: Buffer[], exitCode, durationMs, timedOut }`. Supports `AbortSignal` by cancelling the call.
- `close()` calls `client.close()` to release the channel.

```typescript
import * as grpc from "@grpc/grpc-js";
import { loadProto } from "./proto-loader.js";
import { buildChannelCredentials, type TlsOptions } from "./credentials.js";

export interface ClientOptions {
  endpoint: string;
  tls: TlsOptions;
  timeouts: {
    connect: number; create: number; destroy: number; exec: number; list: number;
    get: number; logs: number; policySet: number; policyStatus: number;
  };
}

interface GrpcUnaryClient {
  Health: grpc.requester<unknown, unknown>;
  CreateSandbox: grpc.requester<unknown, unknown>;
  GetSandbox: grpc.requester<unknown, unknown>;
  ListSandboxes: grpc.requester<unknown, unknown>;
  DeleteSandbox: grpc.requester<unknown, unknown>;
  GetSandboxLogs: grpc.requester<unknown, unknown>;
  UpdateConfig: grpc.requester<unknown, unknown>;
  GetSandboxPolicyStatus: grpc.requester<unknown, unknown>;
  ExecSandbox: (req: unknown, metadata?: grpc.Metadata, options?: grpc.CallOptions) => grpc.ClientReadableStream<unknown>;
  close(): void;
}

function deadline(ms: number): Date { return new Date(Date.now() + ms); }

function unary<TReq, TRes>(
  method: grpc.requester<TReq, TRes>,
  req: TReq,
  deadlineMs: number,
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call({}, req, { deadline: deadline(deadlineMs) }, (err: grpc.ServiceError | null, res?: TRes) => {
      if (err) { reject(err); return; }
      resolve(res as TRes);
    });
  });
}

export interface ExecResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

export class OpenShellClient {
  private readonly raw: GrpcUnaryClient;

  constructor(private readonly options: ClientOptions) {
    const { OpenShellService } = loadProto();
    const creds = buildChannelCredentials(options.tls);
    // The `any` cast here narrows after loadProto() to the generated service constructor;
    // we type the surface we use via GrpcUnaryClient.
    this.raw = new OpenShellService(options.endpoint, creds) as unknown as GrpcUnaryClient;
  }

  async health() { return unary(this.raw.Health.bind(this.raw), {}, this.options.timeouts.connect); }

  async createSandbox(req: unknown) {
    return unary(this.raw.CreateSandbox.bind(this.raw), req, this.options.timeouts.create);
  }
  async getSandbox(req: unknown) {
    return unary(this.raw.GetSandbox.bind(this.raw), req, this.options.timeouts.get);
  }
  async listSandboxes(req: unknown) {
    return unary(this.raw.ListSandboxes.bind(this.raw), req, this.options.timeouts.list);
  }
  async deleteSandbox(req: unknown) {
    return unary(this.raw.DeleteSandbox.bind(this.raw), req, this.options.timeouts.destroy);
  }
  async getSandboxLogs(req: unknown) {
    return unary(this.raw.GetSandboxLogs.bind(this.raw), req, this.options.timeouts.logs);
  }
  async updateConfig(req: unknown) {
    return unary(this.raw.UpdateConfig.bind(this.raw), req, this.options.timeouts.policySet);
  }
  async getSandboxPolicyStatus(req: unknown) {
    return unary(this.raw.GetSandboxPolicyStatus.bind(this.raw), req, this.options.timeouts.policyStatus);
  }

  async execSandbox(req: unknown, signal?: AbortSignal): Promise<ExecResult> {
    const started = Date.now();
    const stream = this.raw.ExecSandbox(req, undefined, { deadline: deadline(this.options.timeouts.exec) });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let exitCode: number | null = null;
    let timedOut = false;

    const onAbort = () => stream.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (event: { stdout?: { data: Buffer }; stderr?: { data: Buffer }; exit?: { exit_code: number } }) => {
          if (event.stdout) stdout.push(Buffer.from(event.stdout.data));
          else if (event.stderr) stderr.push(Buffer.from(event.stderr.data));
          else if (event.exit) exitCode = event.exit.exit_code;
        });
        stream.on("error", (err: grpc.ServiceError) => {
          if (err.code === grpc.status.DEADLINE_EXCEEDED) { timedOut = true; resolve(); return; }
          reject(err);
        });
        stream.on("end", () => resolve());
      });
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    return {
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
      exitCode,
      durationMs: Date.now() - started,
      timedOut,
    };
  }

  close(): void { this.raw.close(); }
}
```

### Step 3 — Unit tests

Mock `loadProto` via `vi.mock("./proto-loader.js")` to return a fake service constructor that records calls and emits synthetic responses.

Cover at minimum:
- Unary methods forward request and return response object.
- Deadline metadata is set (check the third arg passed to the method stub).
- `health()` rejection on gRPC error propagates.
- `execSandbox` aggregates stdout/stderr across events and reports exit code.
- `execSandbox` marks `timedOut: true` on `DEADLINE_EXCEEDED`.
- `execSandbox` aborts on signal (verify `stream.cancel()` called).
- `close()` calls underlying `client.close()`.

- [ ] **Step 4:** Run `pnpm -F @mcp-conductor/provider-openshell test -- tests/openshell-client.test.ts` → green.

- [ ] **Step 5:** Commit.

---

## Task 5: Proto-mirror Zod schemas for tool inputs

Each tool's input schema mirrors a slice of the proto we need. Keeping these in one file (`src/types.ts`) makes future proto updates a one-file audit.

**Files:** `packages/provider-openshell/src/types.ts`

- [ ] **Step 1:** Schemas:

```typescript
import { z } from "zod";

/** openshell.sandbox.v1.L7Allow (subset). */
export const L7AllowSchema = z.object({
  method: z.string().optional(),
  path: z.string().optional(),
  command: z.string().optional(),
}).strict();

/** openshell.sandbox.v1.NetworkEndpoint (subset — enough for mvp). */
export const NetworkEndpointSchema = z.object({
  host: z.string().optional(),
  ports: z.array(z.number().int().min(1).max(65535)).optional(),
  protocol: z.enum(["rest", "sql", ""]).optional(),
  access: z.enum(["read-only", "read-write", "full"]).optional(),
  rules: z.array(z.object({ allow: L7AllowSchema }).strict()).optional(),
}).strict();

/** openshell.sandbox.v1.NetworkPolicyRule. */
export const NetworkPolicyRuleSchema = z.object({
  name: z.string(),
  endpoints: z.array(NetworkEndpointSchema).default([]),
  binaries: z.array(z.object({ path: z.string() }).strict()).default([]),
}).strict();

/** openshell.sandbox.v1.SandboxPolicy. */
export const SandboxPolicySchema = z.object({
  version: z.number().int().nonnegative().default(1),
  filesystem: z.object({
    include_workdir: z.boolean().default(true),
    read_only: z.array(z.string()).default([]),
    read_write: z.array(z.string()).default([]),
  }).strict().default({}),
  landlock: z.object({ compatibility: z.enum(["best_effort", "hard_requirement"]).default("best_effort") }).strict().default({}),
  process: z.object({ run_as_user: z.string().default(""), run_as_group: z.string().default("") }).strict().default({}),
  network_policies: z.record(NetworkPolicyRuleSchema).default({}),
}).strict();

/** openshell.v1.SandboxTemplate. */
export const SandboxTemplateSchema = z.object({
  image: z.string(),
  runtime_class_name: z.string().optional(),
  environment: z.record(z.string()).optional(),
}).strict();

/** openshell.v1.SandboxSpec (subset). */
export const SandboxSpecSchema = z.object({
  log_level: z.string().default("info"),
  environment: z.record(z.string()).default({}),
  template: SandboxTemplateSchema,
  policy: SandboxPolicySchema,
  providers: z.array(z.string()).default([]),
  gpu: z.boolean().default(false),
}).strict();
```

Only include fields we actually send. Additions are cheap; over-specifying what we don't use makes future proto bumps noisier.

- [ ] **Step 2:** Tests `tests/types.test.ts` — round-trip a sample policy and a sample spec through `.parse()`; confirm defaults fill in; confirm unknown keys reject.

- [ ] **Step 3:** Commit.

---

## Task 6: Tool Specs + Name-based Lifecycle Tools

Seven tools. Each tool module exports `{ spec: ToolSpec, handler: (client, options, args, ctx) => Promise<ToolCallResult> }`.

**Files:** `packages/provider-openshell/src/tools/{specs.ts,sandbox-create.ts,sandbox-get.ts,sandbox-list.ts,sandbox-destroy.ts}`, tests

- [ ] **Step 1:** `src/tools/specs.ts` — all eight `ToolSpec` constants (JSON Schemas). `additionalProperties: false` everywhere.

- [ ] **Step 2:** Implement `sandbox-create.ts`:
  - Input: `{ name?: string, spec: SandboxSpec }`.
  - Validates `name` against `sandboxNamePattern`.
  - `client.createSandbox({ name, spec })` → returns structured `Sandbox` in `{ type: "json", json: sandbox }` content.
  - gRPC error → `{ isError: true, content: [{ type: "text", text: "[create-failed:<code>] <message>" }] }` — use `grpc.status[err.code]` for readable code names.

- [ ] **Step 3:** Implement `sandbox-get.ts`:
  - Input: `{ name }`. Validates pattern. Returns `{ type: "json", json: sandbox }`.

- [ ] **Step 4:** Implement `sandbox-list.ts`:
  - Input: `{ limit?: number, offset?: number }` (bounded limit, e.g. max 500).
  - Returns `{ type: "json", json: { sandboxes, nextOffset } }`.

- [ ] **Step 5:** Implement `sandbox-destroy.ts`:
  - Input: `{ name }`. Validates pattern.
  - `client.deleteSandbox({ name })` → text result `deleted: true|false`.

- [ ] **Step 6:** Tests — unit (mocked `OpenShellClient`) cover: happy path, gRPC error surfaced as `isError`, name pattern rejection without hitting client, default limit applied.

- [ ] **Step 7:** Commit.

---

## Task 7: `sandbox_exec` — The Load-Bearing Primitive

Server-streaming RPC: `ExecSandbox(ExecSandboxRequest) returns (stream ExecSandboxEvent)`. Our client already aggregates events — this tool turns the aggregated `ExecResult` into an MCP `ToolCallResult`.

**Input args:** `{ name: string, command: string[] (minItems: 1), workdir?: string, environment?: Record<string, string>, timeoutSeconds?: number, stdin?: string }`.

**Proto uses `sandbox_id`, not name.** We resolve name → id via `client.getSandbox({ name })` first, then call `client.execSandbox({ sandbox_id, command, ... })`. One extra round-trip — accept it for UX.

**Files:** `packages/provider-openshell/src/tools/sandbox-exec.ts`, tests

- [ ] **Step 1:** Failing unit tests (mocked `OpenShellClient`):
  - Happy path: name → id lookup called; exec called with `sandbox_id` + `command`; result contains stdout, stderr, exit.
  - Non-zero exit code flagged `isError: true`, content still includes stdout+stderr so the caller sees the failure detail.
  - Timeout (`ExecResult.timedOut: true`) → `isError: true` with `[timeout]` prefix.
  - Name pattern rejection → no RPCs made.
  - `ctx.signal.aborted` forwarded into `client.execSandbox` (check it was passed as the second arg).
  - `GetSandbox` NOT_FOUND → `isError: true` with a helpful message ("sandbox `X` not found").

- [ ] **Step 2:** Impl (sketch):

```typescript
export async function handler(client, options, rawArgs, ctx) {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) return textError(`invalid args: ${parsed.error.message}`);
  if (!new RegExp(options.sandboxNamePattern).test(parsed.data.name)) return textError("invalid sandbox name");

  const { sandbox } = await client.getSandbox({ name: parsed.data.name });
  if (!sandbox) return textError(`sandbox not found: ${parsed.data.name}`);

  const execReq = {
    sandbox_id: sandbox.id,
    command: parsed.data.command,
    workdir: parsed.data.workdir ?? "",
    environment: parsed.data.environment ?? {},
    timeout_seconds: parsed.data.timeoutSeconds ?? 0,
    stdin: parsed.data.stdin ? Buffer.from(parsed.data.stdin, "utf8") : Buffer.alloc(0),
    tty: false,
  };
  const result = await client.execSandbox(execReq, ctx.signal);

  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");
  if (result.timedOut) return textError(`[timeout] exec exceeded deadline\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`);
  const isError = result.exitCode !== 0;
  return {
    isError,
    content: [{
      type: "text",
      text: `exit: ${result.exitCode}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}\n\nduration: ${result.durationMs}ms`,
    }],
  };
}
```

- [ ] **Step 3:** Integration test (gated): create a sandbox, exec `["echo", "hello"]`, assert `exit: 0` + stdout contains `hello`; exec `["false"]`, assert non-zero exit reported with `isError: true`; destroy.

- [ ] **Step 4:** Commit.

---

## Task 8: `sandbox_logs`

One-shot RPC: `GetSandboxLogs(sandbox_id, lines, since_ms)`. Name → id lookup as in `sandbox_exec`.

**Input args:** `{ name: string, lines?: number (1..10000, default 500), sinceMs?: number }`.

**Files:** `packages/provider-openshell/src/tools/sandbox-logs.ts`, tests

- [ ] **Step 1:** Failing unit tests — happy path, name lookup, upper-bound clamp on `lines`, NOT_FOUND error.

- [ ] **Step 2:** Impl — resolve name, call `client.getSandboxLogs({ sandbox_id, lines, since_ms })`, return response as `{ type: "json", json: response }` OR as text if response is simple strings (confirm shape during Task 0).

- [ ] **Step 3:** Commit.

---

## Task 9: `policy_set` + `policy_status`

`policy_set` → `UpdateConfig`. `policy_status` → `GetSandboxPolicyStatus`.

**Files:** `packages/provider-openshell/src/tools/{policy-set.ts,policy-status.ts}`, tests

- [ ] **Step 1:** `policy-set.ts`:
  - Input: `{ name: string, policy: SandboxPolicy, global?: false }` for the MVP — sandbox scope only. (Global scope is a later addition; docs for it are the same RPC but with `global: true` and different validation rules — defer.)
  - Parse `policy` through `SandboxPolicySchema` before sending.
  - Call `client.updateConfig({ name, policy, global: false })`; return `{ type: "json", json: { version, policy_hash } }`.

- [ ] **Step 2:** `policy-status.ts`:
  - Input: `{ name, version?: number (default 0 = latest) }`.
  - Call `client.getSandboxPolicyStatus({ name, version, global: false })`.
  - Return the response as json.

- [ ] **Step 3:** Tests (unit + integration).

- [ ] **Step 4:** Commit.

---

## Task 10: `OpenShellProvider` class

**Files:** `packages/provider-openshell/src/openshell-provider.ts`, `packages/provider-openshell/tests/openshell-provider.test.ts`

- [ ] **Step 1:** Failing tests — construct with mocked `OpenShellClient` injected through the second constructor arg; cover:
  - `connect()` calls `client.health()` and throws `ProviderError` on failure.
  - `listTools()` returns eight tools with valid JSON Schemas.
  - `callTool` routes to the right handler by name; unknown name throws `ProviderError`.
  - `callTool` propagates `ctx.signal` into `sandbox_exec` handler.
  - `close()` calls `client.close()`.

- [ ] **Step 2:** Impl

```typescript
import { ProviderError } from "@mcp-conductor/core";
import type { ToolCallContext, ToolCallResult, ToolProvider, ToolSpec } from "@mcp-conductor/core";
import { OpenShellClient } from "./openshell-client.js";
import { OpenShellProviderOptionsSchema, type OpenShellProviderOptions } from "./config.js";
import * as specs from "./tools/specs.js";
import * as sandboxCreate from "./tools/sandbox-create.js";
import * as sandboxGet from "./tools/sandbox-get.js";
import * as sandboxList from "./tools/sandbox-list.js";
import * as sandboxDestroy from "./tools/sandbox-destroy.js";
import * as sandboxExec from "./tools/sandbox-exec.js";
import * as sandboxLogs from "./tools/sandbox-logs.js";
import * as policySet from "./tools/policy-set.js";
import * as policyStatus from "./tools/policy-status.js";

type Handler = (client: OpenShellClient, options: OpenShellProviderOptions, args: unknown, ctx: ToolCallContext) => Promise<ToolCallResult>;

export class OpenShellProvider implements ToolProvider {
  readonly name: string;
  private readonly options: OpenShellProviderOptions;
  private readonly client: OpenShellClient;
  private readonly handlers: Record<string, Handler>;

  constructor(options: unknown, deps: { client?: OpenShellClient } = {}) {
    this.options = OpenShellProviderOptionsSchema.parse(options ?? {});
    this.name = this.options.name;
    this.client = deps.client ?? new OpenShellClient({
      endpoint: this.options.endpoint,
      tls: this.options.tls,
      timeouts: this.options.timeouts,
    });
    this.handlers = {
      sandbox_create: sandboxCreate.handler,
      sandbox_get: sandboxGet.handler,
      sandbox_list: sandboxList.handler,
      sandbox_destroy: sandboxDestroy.handler,
      sandbox_exec: sandboxExec.handler,
      sandbox_logs: sandboxLogs.handler,
      policy_set: policySet.handler,
      policy_status: policyStatus.handler,
    };
  }

  async connect(): Promise<void> {
    try { await this.client.health(); }
    catch (err) { throw new ProviderError(`openshell health failed: ${(err as Error).message}`, this.name); }
  }

  async close(): Promise<void> { this.client.close(); }

  async listTools(): Promise<ToolSpec[]> {
    return [
      specs.SANDBOX_CREATE, specs.SANDBOX_GET, specs.SANDBOX_LIST, specs.SANDBOX_DESTROY,
      specs.SANDBOX_EXEC, specs.SANDBOX_LOGS, specs.POLICY_SET, specs.POLICY_STATUS,
    ];
  }

  async callTool(name: string, args: unknown, ctx: ToolCallContext): Promise<ToolCallResult> {
    const handler = this.handlers[name];
    if (!handler) throw new ProviderError(`unknown tool: ${name}`, this.name);
    return handler(this.client, this.options, args, ctx);
  }
}
```

- [ ] **Step 3:** Run tests → green.

- [ ] **Step 4:** Commit.

---

## Task 11: Barrel, README, Full Verification

- [ ] **Step 1:** `src/index.ts`:

```typescript
export const VERSION = "0.1.0";
export { OpenShellProvider } from "./openshell-provider.js";
export { OpenShellClient } from "./openshell-client.js";
export { OpenShellProviderOptionsSchema } from "./config.js";
export type { OpenShellProviderOptions, TlsOptions } from "./config.js";
export { SandboxPolicySchema, SandboxSpecSchema } from "./types.js";
```

- [ ] **Step 2:** `README.md` — prereqs (an OpenShell gateway reachable from the mcp-conductor host, auth material if using mTLS), install snippet, example `ProviderRegistry.register(new OpenShellProvider({ endpoint: "...", tls: { mode: "mtls", ... } }))`, list of the 8 tools with one-line descriptions, note that the vendored protos are pinned to a specific upstream commit (see `PROTO_VERSION.md`).

- [ ] **Step 3:** From repo root: `pnpm install && pnpm -r typecheck && pnpm -r build && pnpm -r test`.

- [ ] **Step 4:** Expected unit test counts — credentials (~5) + config (~6) + types (~3) + openshell-client (~7) + openshell-provider (~6) + per-tool unit (~2–3 each × 8 ≈ 20) ≈ **45–50 unit tests PASS**. Integration tests gated behind `VITEST_INTEGRATION=1` run separately against a live gateway.

- [ ] **Step 5:** Commit + push branch.

---

## Self-Review

- [x] Package name: `@mcp-conductor/provider-openshell` (matches `provider-mcp` convention; leaves room for sibling `provider-sandbox-*` packages).
- [x] **Talks to OpenShell's gRPC gateway directly — no `child_process.spawn`, no CLI wrapping.**
- [x] Implements `ToolProvider` only — no HTTP surface, no MCP translation, no audit writes.
- [x] No universal `run_code`/`run_shell` abstraction — native gRPC-shaped tool surface, first-class streaming for `sandbox_exec`.
- [x] `OpenShellClient` is the single gRPC chokepoint; deadlines always set; `AbortSignal` forwarded into streaming `ExecSandbox`.
- [x] Three clean auth modes (insecure / TLS / mTLS); PEM material accepted as path or inline bytes.
- [x] `Health` preflight at `connect()`; `ProviderError` on failure; no `describe.skip`.
- [x] Integration tests gated by env var; unit tests mock `OpenShellClient` via constructor injection.
- [x] `ctx.signal` propagates into `OpenShellClient.execSandbox`.
- [x] `connect` / `close` are the full lifecycle surface (per `ToolProvider`); `close()` releases the gRPC channel.
- [x] Vendored protos pinned in `PROTO_VERSION.md`; update procedure documented.
- [x] Policy accepted as structured `SandboxPolicy` object (zod-validated), not YAML — no YAML parser in the hot path.
- [x] `sandbox_exec` resolves sandbox name → id via `GetSandbox` before calling `ExecSandbox` (which requires id per proto).
- [x] Future sandbox providers (Deno, E2B, Modal, Docker, ...) ship as separate packages; no forced shared abstraction layer.
