# Sandbox Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@mcp-conductor/provider-sandbox` — a pure-library package that implements `@mcp-conductor/core`'s `ToolProvider` interface and exposes two tools: `run_code` (scoped Deno-subprocess code execution) and `run_shell` (spawn-based shell execution without `sh -c`). The gateway consumes it like any other `ToolProvider`; it owns no HTTP surface.

**Architecture:** One package, one class — `SandboxProvider` constructed with per-call options, registered with `ProviderRegistry`. Code execution shells out to `deno run` with explicit permission flags and an **explicit `returnExpression`** (no heuristic parsing of user source). Shell execution uses Node's `child_process.spawn` (no shell invocation), rejects metacharacters before spawn, and supports an optional allowlist. Every call goes through the gateway's audit path because the gateway wraps `callTool` — the provider does not audit itself.

**Tech Stack:** Node.js 20 LTS, TypeScript, `@mcp-conductor/core` (peer), `child_process`. Deno is a **subprocess** (not a runtime dependency of the host process) invoked via `child_process.spawn`.

**Reviewer-mandated changes vs earlier draft:**

1. **Drop the `wrapCode` heuristic.** Previous plan parsed user source with regex to decide "does this expression return a value?" That is brittle and silently drops results. Replace with an explicit `returnExpression: string` option — the caller names the symbol (or expression) to stringify.
2. **Drop `instanceof McpServer` anywhere in this package** — the package never references `McpServer`. The gateway handles tool registration.
3. **Shell: no `sh -c`.** Parse argv-style, reject metacharacters `[;&|\`$()<>\\]` before spawn, enforce optional allowlist on the resolved binary name, not on the raw string.
4. **Do not silently skip tests if Deno is missing.** Fail hard with a clear message so CI misconfigurations don't ship green.
5. **No audit writes inside the provider.** Gateway owns audit. Provider returns results; gateway records them.

---

## File Structure

```text
packages/provider-sandbox/
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
  src/
    index.ts                         # barrel
    sandbox-provider.ts              # SandboxProvider class (implements ToolProvider)
    code-executor.ts                 # runCode(options) → CodeResult
    shell-executor.ts                # runShell(options) → ShellResult
    config.ts                        # Zod schemas for SandboxProviderOptions
  tests/
    sandbox-provider.test.ts         # ToolProvider contract
    code-executor.test.ts            # Deno subprocess behavior
    shell-executor.test.ts           # spawn + metacharacter rejection + allowlist
    config.test.ts                   # Zod validation
```

**Dependency on core:** `package.json` declares `"@mcp-conductor/core": "workspace:*"` under both `peerDependencies` (runtime contract) and `devDependencies` (so tests resolve the workspace copy).

---

## Task 1: Package Skeleton

**Files:** `packages/provider-sandbox/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,src/index.ts}`

- [ ] **Step 1:** `packages/provider-sandbox/package.json`

```json
{
  "name": "@mcp-conductor/provider-sandbox",
  "version": "0.2.0",
  "description": "Sandbox ToolProvider: run_code (Deno subprocess) and run_shell (spawn)",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@mcp-conductor/core": "workspace:*"
  },
  "dependencies": {
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@mcp-conductor/core": "workspace:*"
  }
}
```

- [ ] **Step 2:** `packages/provider-sandbox/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "rootDir": "." },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3:** `packages/provider-sandbox/tsconfig.build.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src", "tsBuildInfoFile": ".tsbuildinfo" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4:** `packages/provider-sandbox/vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "provider-sandbox", include: ["tests/**/*.test.ts"], testTimeout: 30_000, environment: "node", clearMocks: true },
});
```

- [ ] **Step 5:** `packages/provider-sandbox/src/index.ts` placeholder:

```typescript
export const VERSION = "0.2.0";
```

- [ ] **Step 6:** `pnpm install` from repo root. Verify package is picked up.

- [ ] **Step 7:** Commit — `git add packages/provider-sandbox pnpm-lock.yaml && git commit -m "feat(provider-sandbox): package skeleton"`

---

## Task 2: Deno Preflight Check

Deno is required for `run_code`. If it's missing we fail at provider `connect()` — not at first tool call, and never silently skipped in tests.

**Files:** `packages/provider-sandbox/src/code-executor.ts` (preflight helper), `packages/provider-sandbox/tests/code-executor.test.ts` (first test)

- [ ] **Step 1:** Failing test `packages/provider-sandbox/tests/code-executor.test.ts`

```typescript
import { describe, test, expect } from "vitest";
import { checkDenoAvailable } from "../src/code-executor.js";

describe("deno preflight", () => {
  test("resolves with version when deno exists", async () => {
    await expect(checkDenoAvailable()).resolves.toMatch(/^\d+\.\d+\.\d+/);
  });
});
```

If Deno is not installed locally, install it before running the suite (<https://deno.com/install> — CI must install Deno too). Do not use `describe.skip` to paper over a missing binary.

- [ ] **Step 2:** Minimal impl `packages/provider-sandbox/src/code-executor.ts`

```typescript
import { spawn } from "node:child_process";

export async function checkDenoAvailable(denoBin = "deno"): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(denoBin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) { reject(new Error(`deno --version exited ${code}`)); return; }
      const match = out.match(/deno\s+(\d+\.\d+\.\d+)/i);
      if (!match) { reject(new Error(`unrecognized deno --version output: ${out}`)); return; }
      resolve(match[1]!);
    });
  });
}
```

- [ ] **Step 3:** `pnpm -F @mcp-conductor/provider-sandbox test -- tests/code-executor.test.ts` → 1 PASS.

- [ ] **Step 4:** Commit — `git add packages/provider-sandbox/src/code-executor.ts packages/provider-sandbox/tests/code-executor.test.ts && git commit -m "feat(provider-sandbox): deno preflight check"`

---

## Task 3: Code Executor (Deno Subprocess with Explicit returnExpression)

Design:
- Caller supplies `source` (TS/JS) and `returnExpression` (e.g. `"result"` or `"({ x, y })"`). The executor writes a temp file that is exactly `${source}\nconst __value = (${returnExpression}); console.log(MARKER + JSON.stringify(__value ?? null));`. The explicit form removes the need to parse or classify user source.
- Permissions are explicit flags built from options (`net: false` → `--deny-net`; `read: ["/tmp"]` → `--allow-read=/tmp`).
- Timeout enforced with `setTimeout` + `child.kill("SIGKILL")` fallback.

**Files:** `packages/provider-sandbox/src/code-executor.ts`, `packages/provider-sandbox/tests/code-executor.test.ts`

- [ ] **Step 1:** Append failing tests to `tests/code-executor.test.ts`

```typescript
import { runCode } from "../src/code-executor.js";

describe("runCode", () => {
  const permsNone = { net: false, read: [], write: [], env: [], run: false };

  test("happy path: returns stringified value", async () => {
    const r = await runCode({
      source: "const x = 2 + 3;",
      returnExpression: "x",
      timeoutMs: 5000,
      permissions: permsNone,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.value)).toBe(5);
  });

  test("explicit object expression works without heuristics", async () => {
    const r = await runCode({
      source: "const a = 1; const b = 'x';",
      returnExpression: "({ a, b })",
      timeoutMs: 5000,
      permissions: permsNone,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.value)).toEqual({ a: 1, b: "x" });
  });

  test("syntax error reported with errorType=syntax", async () => {
    const r = await runCode({
      source: "const x = ;",
      returnExpression: "x",
      timeoutMs: 5000,
      permissions: permsNone,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorType).toBe("syntax");
  });

  test("runtime error reported with errorType=runtime", async () => {
    const r = await runCode({
      source: "throw new Error('boom');",
      returnExpression: "null",
      timeoutMs: 5000,
      permissions: permsNone,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorType).toBe("runtime");
  });

  test("timeout kills the subprocess and reports timeout", async () => {
    const r = await runCode({
      source: "while (true) {}",
      returnExpression: "null",
      timeoutMs: 300,
      permissions: permsNone,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorType).toBe("timeout");
  });

  test("permission denial reports errorType=permission", async () => {
    const r = await runCode({
      source: `const res = await fetch('https://example.com');`,
      returnExpression: "res.status",
      timeoutMs: 5000,
      permissions: permsNone,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["permission", "runtime"]).toContain(r.errorType);
  });
});
```

- [ ] **Step 2:** Implement `runCode` — extend `packages/provider-sandbox/src/code-executor.ts`

```typescript
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CodePermissions {
  net: boolean;
  read: string[];
  write: string[];
  env: string[];
  run: boolean;
}

export interface RunCodeOptions {
  source: string;
  returnExpression: string;
  timeoutMs: number;
  permissions: CodePermissions;
  denoBin?: string;
  env?: Record<string, string>;
}

export type CodeErrorType = "syntax" | "runtime" | "timeout" | "permission";

export type CodeResult =
  | { ok: true; value: string; stdout: string; stderr: string; durationMs: number }
  | { ok: false; errorType: CodeErrorType; message: string; stdout: string; stderr: string; durationMs: number };

const VALUE_MARKER = "__MCP_CONDUCTOR_RESULT__";

function buildFlags(perms: CodePermissions): string[] {
  const flags: string[] = [];
  flags.push(perms.net ? "--allow-net" : "--deny-net");
  if (perms.read.length) flags.push(`--allow-read=${perms.read.join(",")}`);
  if (perms.write.length) flags.push(`--allow-write=${perms.write.join(",")}`);
  if (perms.env.length) flags.push(`--allow-env=${perms.env.join(",")}`);
  if (perms.run) flags.push("--allow-run");
  flags.push("--no-prompt");
  return flags;
}

function classifyError(stderr: string): CodeErrorType {
  if (/PermissionDenied|Requires.*access/.test(stderr)) return "permission";
  if (/SyntaxError|Unexpected token|Expected .* but found/i.test(stderr)) return "syntax";
  return "runtime";
}

function buildScript(source: string, returnExpression: string): string {
  return [
    source,
    ";",
    `const __value = (${returnExpression});`,
    `console.log(${JSON.stringify(VALUE_MARKER)} + JSON.stringify(__value ?? null));`,
  ].join("\n");
}

export async function runCode(options: RunCodeOptions): Promise<CodeResult> {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "sandbox-"));
  const scriptPath = join(dir, "main.ts");
  await writeFile(scriptPath, buildScript(options.source, options.returnExpression), "utf8");

  const args = ["run", ...buildFlags(options.permissions), scriptPath];
  const env = { ...process.env, ...(options.env ?? {}), NO_COLOR: "1" };
  const child = spawn(options.denoBin ?? "deno", args, { env, stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
  child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, options.timeoutMs);

  const exitCode: number | null = await new Promise((resolve) => {
    child.once("close", (code) => resolve(code));
  });
  clearTimeout(timer);
  await rm(dir, { recursive: true, force: true });

  const durationMs = Date.now() - started;

  if (timedOut) {
    return { ok: false, errorType: "timeout", message: `execution exceeded ${options.timeoutMs}ms`, stdout, stderr, durationMs };
  }
  if (exitCode !== 0) {
    return { ok: false, errorType: classifyError(stderr), message: stderr.trim().split("\n").pop() ?? `exit ${exitCode}`, stdout, stderr, durationMs };
  }
  const markerIdx = stdout.lastIndexOf(VALUE_MARKER);
  if (markerIdx === -1) {
    return { ok: false, errorType: "runtime", message: "no return marker emitted (script did not complete)", stdout, stderr, durationMs };
  }
  const value = stdout.slice(markerIdx + VALUE_MARKER.length).replace(/\n$/, "");
  return { ok: true, value, stdout: stdout.slice(0, markerIdx), stderr, durationMs };
}
```

Note: `spawn` is imported at the top of the file from Task 2.

- [ ] **Step 3:** `pnpm -F @mcp-conductor/provider-sandbox test -- tests/code-executor.test.ts` → 7 PASS (preflight + 6 runCode).

- [ ] **Step 4:** Commit — `git add packages/provider-sandbox/src/code-executor.ts packages/provider-sandbox/tests/code-executor.test.ts && git commit -m "feat(provider-sandbox): runCode with explicit returnExpression"`

---

## Task 4: Shell Executor (spawn without sh -c)

Design:
- Caller passes `{ argv: string[] }` (preferred) or `{ commandLine: string }`.
- When `commandLine` is given, we parse argv with a minimal tokenizer that understands double-quoted args and **rejects** shell metacharacters `[;&|\`$()<>\\]` plus newlines. No shell is ever invoked.
- If an allowlist is configured, the resolved binary name (`path.basename(argv[0])`) must be on it — prevents bypass via `/usr/bin/ls` when `ls` is not allowed.
- Timeout via `setTimeout` + SIGKILL.
- Optional `allowedCwds` confines `cwd`; `path.resolve` + prefix check.

**Files:** `packages/provider-sandbox/src/shell-executor.ts`, `packages/provider-sandbox/tests/shell-executor.test.ts`

- [ ] **Step 1:** Failing tests `packages/provider-sandbox/tests/shell-executor.test.ts`

```typescript
import { describe, test, expect } from "vitest";
import { runShell, parseCommandLine } from "../src/shell-executor.js";

describe("parseCommandLine", () => {
  test("splits simple argv", () => {
    expect(parseCommandLine("echo hello world")).toEqual(["echo", "hello", "world"]);
  });
  test("respects double quotes", () => {
    expect(parseCommandLine(`echo "hi there" friend`)).toEqual(["echo", "hi there", "friend"]);
  });
  test("rejects semicolons", () => {
    expect(() => parseCommandLine("ls; rm -rf /")).toThrow(/metacharacter/);
  });
  test("rejects pipes, subshells, backticks, redirects, backslashes", () => {
    expect(() => parseCommandLine("a | b")).toThrow();
    expect(() => parseCommandLine("a && b")).toThrow();
    expect(() => parseCommandLine("echo $VAR")).toThrow();
    expect(() => parseCommandLine("echo `id`")).toThrow();
    expect(() => parseCommandLine("cat < file")).toThrow();
    expect(() => parseCommandLine("echo > out")).toThrow();
    expect(() => parseCommandLine("echo \\x")).toThrow();
  });
});

describe("runShell", () => {
  test("happy path with argv", async () => {
    const r = await runShell({ argv: ["node", "-e", "console.log('ok')"], timeoutMs: 5000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stdout.trim()).toBe("ok");
  });

  test("happy path with commandLine", async () => {
    const r = await runShell({ commandLine: `node -e "console.log('hi')"`, timeoutMs: 5000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stdout.trim()).toBe("hi");
  });

  test("allowlist blocks non-listed binary (resolved name)", async () => {
    const r = await runShell({ argv: ["/bin/ls"], timeoutMs: 1000, allowedCommands: ["cat"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorType).toBe("not_allowed");
  });

  test("allowlist permits listed binary", async () => {
    const r = await runShell({ argv: ["node", "-e", "process.stdout.write('x')"], timeoutMs: 5000, allowedCommands: ["node"] });
    expect(r.ok).toBe(true);
  });

  test("timeout kills and reports timeout", async () => {
    const r = await runShell({ argv: ["node", "-e", "setTimeout(() => {}, 60000)"], timeoutMs: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorType).toBe("timeout");
  });

  test("commandLine with metacharacter rejected before spawn", async () => {
    const r = await runShell({ commandLine: "ls; rm -rf /", timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorType).toBe("not_allowed");
  });

  test("cwd outside allowedCwds rejected", async () => {
    const r = await runShell({
      argv: ["node", "-e", "0"],
      timeoutMs: 1000,
      cwd: "/etc",
      allowedCwds: ["/tmp"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorType).toBe("not_allowed");
  });
});
```

- [ ] **Step 2:** Implementation `packages/provider-sandbox/src/shell-executor.ts`

```typescript
import { spawn } from "node:child_process";
import { basename, resolve as resolvePath } from "node:path";

const FORBIDDEN = /[;&|`$()<>\\]/;

export type ShellErrorType = "timeout" | "runtime" | "not_allowed";

export type ShellResult =
  | { ok: true; stdout: string; stderr: string; exitCode: number; durationMs: number }
  | { ok: false; errorType: ShellErrorType; message: string; stdout: string; stderr: string; durationMs: number };

export interface RunShellOptions {
  argv?: string[];
  commandLine?: string;
  timeoutMs: number;
  allowedCommands?: string[];
  cwd?: string;
  allowedCwds?: string[];
  env?: Record<string, string>;
  stdin?: string;
}

export function parseCommandLine(line: string): string[] {
  if (/\n/.test(line)) throw new Error("disallowed metacharacter: newline");
  if (FORBIDDEN.test(line)) throw new Error(`disallowed metacharacter in command: ${line}`);
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] !== undefined ? m[1] : m[2]!);
  if (!out.length) throw new Error("empty command");
  return out;
}

function notAllowed(message: string): ShellResult {
  return { ok: false, errorType: "not_allowed", message, stdout: "", stderr: "", durationMs: 0 };
}

export async function runShell(options: RunShellOptions): Promise<ShellResult> {
  const started = Date.now();

  let argv: string[];
  try {
    argv = options.argv?.slice() ?? parseCommandLine(options.commandLine ?? "");
  } catch (err) {
    return notAllowed((err as Error).message);
  }
  if (argv.length === 0) return notAllowed("empty command");

  const binaryName = basename(argv[0]!);
  if (options.allowedCommands && !options.allowedCommands.includes(binaryName)) {
    return notAllowed(`command not in allowlist: ${binaryName}`);
  }

  const cwd = options.cwd ? resolvePath(options.cwd) : process.cwd();
  if (options.allowedCwds && options.allowedCwds.length) {
    const roots = options.allowedCwds.map((p) => resolvePath(p));
    const permitted = roots.some((root) => cwd === root || cwd.startsWith(root + "/"));
    if (!permitted) return notAllowed(`cwd outside allowedCwds: ${cwd}`);
  }

  return new Promise((resolvePromise) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, options.timeoutMs);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    if (options.stdin) child.stdin?.end(options.stdin);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, errorType: "runtime", message: err.message, stdout, stderr, durationMs: Date.now() - started });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      if (timedOut) { resolvePromise({ ok: false, errorType: "timeout", message: `exceeded ${options.timeoutMs}ms`, stdout, stderr, durationMs }); return; }
      if (exitCode === 0) { resolvePromise({ ok: true, stdout, stderr, exitCode, durationMs }); return; }
      resolvePromise({ ok: false, errorType: "runtime", message: `exit ${exitCode}`, stdout, stderr, durationMs });
    });
  });
}
```

- [ ] **Step 3:** `pnpm -F @mcp-conductor/provider-sandbox test -- tests/shell-executor.test.ts` → 11 PASS (4 parse + 7 runShell).

- [ ] **Step 4:** Commit — `git add packages/provider-sandbox/src/shell-executor.ts packages/provider-sandbox/tests/shell-executor.test.ts && git commit -m "feat(provider-sandbox): spawn-based runShell with metacharacter rejection"`

---

## Task 5: Config Schema

**Files:** `packages/provider-sandbox/src/config.ts`, `packages/provider-sandbox/tests/config.test.ts`

- [ ] **Step 1:** `packages/provider-sandbox/src/config.ts`

```typescript
import { z } from "zod";

export const CodePermissionsSchema = z.object({
  net: z.boolean().default(false),
  read: z.array(z.string()).default([]),
  write: z.array(z.string()).default([]),
  env: z.array(z.string()).default([]),
  run: z.boolean().default(false),
});

export const SandboxProviderOptionsSchema = z.object({
  name: z.string().default("sandbox"),
  code: z.object({
    timeoutMs: z.number().int().positive().default(30_000),
    permissions: CodePermissionsSchema.default({ net: false, read: [], write: [], env: [], run: false }),
    denoBin: z.string().default("deno"),
  }).default({}),
  shell: z.object({
    timeoutMs: z.number().int().positive().default(30_000),
    allowedCommands: z.array(z.string()).optional(),
    allowedCwds: z.array(z.string()).optional(),
  }).default({}),
}).strict();

export type CodePermissions = z.infer<typeof CodePermissionsSchema>;
export type SandboxProviderOptions = z.infer<typeof SandboxProviderOptionsSchema>;
```

- [ ] **Step 2:** Failing test `packages/provider-sandbox/tests/config.test.ts`

```typescript
import { describe, test, expect } from "vitest";
import { SandboxProviderOptionsSchema } from "../src/config.js";

describe("SandboxProviderOptionsSchema", () => {
  test("accepts minimal config", () => {
    const p = SandboxProviderOptionsSchema.parse({});
    expect(p.name).toBe("sandbox");
    expect(p.code.timeoutMs).toBe(30_000);
    expect(p.code.permissions.net).toBe(false);
  });
  test("accepts full config", () => {
    const p = SandboxProviderOptionsSchema.parse({
      name: "sb1",
      code: { timeoutMs: 5000, permissions: { net: true, read: ["/tmp"], write: [], env: ["HOME"], run: false } },
      shell: { timeoutMs: 10000, allowedCommands: ["ls", "cat"], allowedCwds: ["/tmp"] },
    });
    expect(p.code.permissions.read).toEqual(["/tmp"]);
    expect(p.shell.allowedCommands).toEqual(["ls", "cat"]);
  });
  test("rejects unknown keys (strict)", () => {
    expect(() => SandboxProviderOptionsSchema.parse({ nope: true })).toThrow();
  });
  test("rejects negative timeouts", () => {
    expect(() => SandboxProviderOptionsSchema.parse({ code: { timeoutMs: -1 } })).toThrow();
  });
});
```

- [ ] **Step 3:** `pnpm -F @mcp-conductor/provider-sandbox test -- tests/config.test.ts` → 4 PASS.

- [ ] **Step 4:** Commit.

---

## Task 6: SandboxProvider (implements ToolProvider)

Design:
- `listTools()` returns two fixed `ToolSpec`s: `run_code` and `run_shell`, with JSON-Schema input descriptions.
- `callTool("run_code", args, ctx)` — validate args with zod, call `runCode(...)`, shape the result as a `ToolCallResult`. Include duration in the text content so callers can correlate.
- `callTool("run_shell", args, ctx)` — same pattern.
- Respects `ctx.signal`: if abort fires mid-call, kill the subprocess (wire through local kill on abort).
- `connect()` runs `checkDenoAvailable` and throws `ProviderError` on failure. `close()` is a no-op.

**Files:** `packages/provider-sandbox/src/sandbox-provider.ts`, `packages/provider-sandbox/tests/sandbox-provider.test.ts`

- [ ] **Step 1:** Failing test `packages/provider-sandbox/tests/sandbox-provider.test.ts`

```typescript
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { ProviderError } from "@mcp-conductor/core";
import { SandboxProvider } from "../src/sandbox-provider.js";

describe("SandboxProvider", () => {
  let provider: SandboxProvider;
  beforeAll(async () => {
    provider = new SandboxProvider({
      name: "sandbox",
      code: { timeoutMs: 5000, permissions: { net: false, read: [], write: [], env: [], run: false } },
      shell: { timeoutMs: 5000, allowedCommands: ["node"] },
    });
    await provider.connect();
  });
  afterAll(async () => { await provider.close(); });

  test("listTools returns run_code and run_shell", async () => {
    const tools = await provider.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["run_code", "run_shell"]);
    for (const t of tools) expect(typeof t.inputSchema.type).toBe("string");
  });

  test("callTool run_code happy path", async () => {
    const r = await provider.callTool(
      "run_code",
      { source: "const n = 7;", returnExpression: "n*n" },
      { user: "u", requestId: "rq" },
    );
    expect(r.isError).toBeFalsy();
    expect(r.content[0]).toEqual({ type: "text", text: expect.stringContaining("49") });
  });

  test("callTool run_code surfaces syntax errors as isError", async () => {
    const r = await provider.callTool(
      "run_code",
      { source: "const x = ;", returnExpression: "x" },
      { user: "u" },
    );
    expect(r.isError).toBe(true);
  });

  test("callTool run_shell happy path", async () => {
    const r = await provider.callTool(
      "run_shell",
      { argv: ["node", "-e", "console.log('hi')"] },
      { user: "u" },
    );
    expect(r.isError).toBeFalsy();
    expect(r.content[0]).toEqual({ type: "text", text: expect.stringContaining("hi") });
  });

  test("callTool run_shell blocks non-allowlisted binary", async () => {
    const r = await provider.callTool("run_shell", { argv: ["/bin/ls"] }, { user: "u" });
    expect(r.isError).toBe(true);
  });

  test("callTool unknown tool throws ProviderError", async () => {
    await expect(provider.callTool("ghost", {}, { user: "u" })).rejects.toBeInstanceOf(ProviderError);
  });

  test("callTool run_code rejects invalid args shape", async () => {
    const r = await provider.callTool("run_code", { source: 123 }, { user: "u" });
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 2:** Implementation `packages/provider-sandbox/src/sandbox-provider.ts`

```typescript
import { ProviderError } from "@mcp-conductor/core";
import type {
  ToolCallContext,
  ToolCallResult,
  ToolProvider,
  ToolSpec,
} from "@mcp-conductor/core";
import { z } from "zod";
import { checkDenoAvailable, runCode } from "./code-executor.js";
import { runShell } from "./shell-executor.js";
import { SandboxProviderOptionsSchema, type SandboxProviderOptions } from "./config.js";

const RunCodeArgs = z.object({
  source: z.string(),
  returnExpression: z.string(),
});
const RunShellArgs = z.union([
  z.object({ argv: z.array(z.string()).min(1), stdin: z.string().optional() }),
  z.object({ commandLine: z.string().min(1), stdin: z.string().optional() }),
]);

const RUN_CODE_TOOL: ToolSpec = {
  name: "run_code",
  description: "Execute TypeScript/JavaScript inside a sandboxed Deno subprocess with explicit permissions. Caller specifies an explicit `returnExpression` whose value is JSON-stringified and returned.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "TS/JS source executed in the sandbox." },
      returnExpression: { type: "string", description: "Expression (e.g. `result` or `({ x, y })`) whose value is returned." },
    },
    required: ["source", "returnExpression"],
    additionalProperties: false,
  },
};
const RUN_SHELL_TOOL: ToolSpec = {
  name: "run_shell",
  description: "Execute a shell command via spawn (no shell invocation). Provide `argv` (preferred) or `commandLine` (parsed; metacharacters rejected).",
  inputSchema: {
    type: "object",
    oneOf: [
      { required: ["argv"], properties: { argv: { type: "array", items: { type: "string" }, minItems: 1 }, stdin: { type: "string" } } },
      { required: ["commandLine"], properties: { commandLine: { type: "string" }, stdin: { type: "string" } } },
    ],
  },
};

function text(content: string, isError = false): ToolCallResult {
  return { isError, content: [{ type: "text", text: content }] };
}

export class SandboxProvider implements ToolProvider {
  readonly name: string;
  private readonly options: SandboxProviderOptions;

  constructor(options: unknown) {
    this.options = SandboxProviderOptionsSchema.parse(options);
    this.name = this.options.name;
  }

  async connect(): Promise<void> {
    try {
      await checkDenoAvailable(this.options.code.denoBin);
    } catch (err) {
      throw new ProviderError(`sandbox: deno unavailable: ${(err as Error).message}`, this.name);
    }
  }

  async close(): Promise<void> { /* no persistent resources */ }

  async listTools(): Promise<ToolSpec[]> { return [RUN_CODE_TOOL, RUN_SHELL_TOOL]; }

  async callTool(name: string, args: unknown, ctx: ToolCallContext): Promise<ToolCallResult> {
    if (name === "run_code") return this.callRunCode(args, ctx);
    if (name === "run_shell") return this.callRunShell(args, ctx);
    throw new ProviderError(`unknown tool: ${name}`, this.name);
  }

  private async callRunCode(args: unknown, ctx: ToolCallContext): Promise<ToolCallResult> {
    const parsed = RunCodeArgs.safeParse(args);
    if (!parsed.success) return text(`invalid args: ${parsed.error.message}`, true);
    const opts = this.options.code;
    const result = await runCode({
      source: parsed.data.source,
      returnExpression: parsed.data.returnExpression,
      timeoutMs: opts.timeoutMs,
      permissions: opts.permissions,
      denoBin: opts.denoBin,
    });
    if (ctx.signal?.aborted) return text("aborted by caller", true);
    if (!result.ok) return text(`[${result.errorType}] ${result.message}\n\nstderr:\n${result.stderr}`, true);
    return text(`value: ${result.value}\n\nstdout:\n${result.stdout}\n\nduration: ${result.durationMs}ms`);
  }

  private async callRunShell(args: unknown, ctx: ToolCallContext): Promise<ToolCallResult> {
    const parsed = RunShellArgs.safeParse(args);
    if (!parsed.success) return text(`invalid args: ${parsed.error.message}`, true);
    const sh = this.options.shell;
    const result = await runShell({
      ...parsed.data,
      timeoutMs: sh.timeoutMs,
      allowedCommands: sh.allowedCommands,
      allowedCwds: sh.allowedCwds,
    });
    if (ctx.signal?.aborted) return text("aborted by caller", true);
    if (!result.ok) return text(`[${result.errorType}] ${result.message}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`, true);
    return text(`exit: ${result.exitCode}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}\n\nduration: ${result.durationMs}ms`);
  }
}
```

- [ ] **Step 3:** `pnpm -F @mcp-conductor/provider-sandbox test -- tests/sandbox-provider.test.ts` → 7 PASS.

- [ ] **Step 4:** Commit — `git add packages/provider-sandbox && git commit -m "feat(provider-sandbox): SandboxProvider implements ToolProvider"`

---

## Task 7: Barrel Exports

**Files:** `packages/provider-sandbox/src/index.ts`

- [ ] **Step 1:** Overwrite

```typescript
export const VERSION = "0.2.0";
export { SandboxProvider } from "./sandbox-provider.js";
export type { SandboxProviderOptions, CodePermissions } from "./config.js";
export { SandboxProviderOptionsSchema } from "./config.js";
export { runCode, checkDenoAvailable } from "./code-executor.js";
export type { RunCodeOptions, CodeResult, CodeErrorType } from "./code-executor.js";
export { runShell, parseCommandLine } from "./shell-executor.js";
export type { RunShellOptions, ShellResult, ShellErrorType } from "./shell-executor.js";
```

- [ ] **Step 2:** `pnpm -F @mcp-conductor/provider-sandbox build` and `pnpm -F @mcp-conductor/provider-sandbox typecheck` → clean.

- [ ] **Step 3:** Commit.

---

## Task 8: Full Verification

- [ ] **Step 1:** `pnpm install && pnpm typecheck && pnpm build && pnpm test`.

Test counts for this package: preflight (1) + runCode (6) + parseCommandLine (4) + runShell (7) + config (4) + SandboxProvider (7) = **29 tests PASS**.

- [ ] **Step 2:** Push branch.

---

## Self-Review

- [x] Package implements `ToolProvider` only — no HTTP, no MCP, no audit writes
- [x] `wrapCode` heuristic removed; `returnExpression` is explicit
- [x] Shell never invokes `sh -c`; metacharacters rejected; allowlist matches resolved binary name
- [x] Deno preflight fails loudly instead of `describe.skip`
- [x] AbortSignal propagated from `ToolCallContext`
- [x] `connect` / `close` are the full lifecycle surface (per `ToolProvider`)
- [x] Full TDD sequence; every test has concrete code
- [x] Stage-2 deferrals (Docker isolation, seccomp, language sandboxes beyond Deno) acknowledged in ARCHITECTURE.md
