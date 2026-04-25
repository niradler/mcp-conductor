import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashApiKey } from "@mcp-conductor/gateway";
import { validateConfigFile, formatValidationResult } from "../src/validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conductor-validate-"));
  configPath = join(dir, "conductor.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(value: unknown): void {
  writeFileSync(configPath, JSON.stringify(value));
}

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    server: { host: "127.0.0.1", port: 18080, maxSessions: 10 },
    users: [{ name: "alice", apiKeyHash: hashApiKey("a-strong-key"), groups: ["admins"] }],
    groups: [{ name: "admins", providers: ["everything"] }],
    providers: [
      {
        type: "mcp",
        name: "everything",
        transport: "stdio",
        // node is virtually always on PATH in test envs; avoids the not-found warning
        command: "node",
        args: ["-e", "console.log('ok')"],
        env: {},
      },
    ],
    audit: { type: "console" },
    telemetry: { serviceName: "test", otlpEndpoint: "" },
    ...overrides,
  };
}

describe("validateConfigFile", () => {
  test("ok: well-formed config produces no errors", async () => {
    writeConfig(baseConfig({ audit: { type: "console" } }));
    const result = await validateConfigFile(configPath);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.config).toBeDefined();
  });

  test("error: missing file", async () => {
    const result = await validateConfigFile(join(dir, "nope.json"));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/cannot read config/);
  });

  test("error: invalid JSON", async () => {
    writeFileSync(configPath, "{ not json");
    const result = await validateConfigFile(configPath);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/invalid JSON/);
  });

  test("error: schema violation surfaces zod path", async () => {
    writeConfig({ ...baseConfig(), users: [] });
    const result = await validateConfigFile(configPath);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("users"))).toBe(true);
  });

  test("error: user references unknown group", async () => {
    writeConfig(
      baseConfig({
        users: [{ name: "alice", apiKeyHash: hashApiKey("k"), groups: ["ghost"] }],
      }),
    );
    const result = await validateConfigFile(configPath);
    expect(result.errors.some((e) => /unknown group "ghost"/.test(e))).toBe(true);
  });

  test("error: group references unknown provider", async () => {
    writeConfig(
      baseConfig({
        groups: [{ name: "admins", providers: ["missing"] }],
      }),
    );
    const result = await validateConfigFile(configPath);
    expect(result.errors.some((e) => /unknown provider "missing"/.test(e))).toBe(true);
  });

  test("error: duplicate provider names", async () => {
    writeConfig(
      baseConfig({
        providers: [
          { type: "mcp", name: "dup", transport: "stdio", command: "node", args: [], env: {} },
          { type: "mcp", name: "dup", transport: "stdio", command: "node", args: [], env: {} },
        ],
        groups: [{ name: "admins", providers: ["dup"] }],
      }),
    );
    const result = await validateConfigFile(configPath);
    expect(result.errors.some((e) => /duplicate provider name: dup/.test(e))).toBe(true);
  });

  test("warning: well-known weak api key", async () => {
    writeConfig(
      baseConfig({
        users: [{ name: "alice", apiKeyHash: hashApiKey("changeme"), groups: ["admins"] }],
        audit: { type: "console" },
      }),
    );
    const result = await validateConfigFile(configPath);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => /weak key/i.test(w))).toBe(true);
  });

  test("warning: missing provider command on PATH", async () => {
    writeConfig(
      baseConfig({
        providers: [
          {
            type: "mcp",
            name: "everything",
            transport: "stdio",
            command: "definitely-does-not-exist-zzz9999",
            args: [],
            env: {},
          },
        ],
        audit: { type: "console" },
      }),
    );
    const result = await validateConfigFile(configPath);
    expect(result.warnings.some((w) => /not found on PATH/.test(w))).toBe(true);
  });

  test("warning: console audit", async () => {
    writeConfig(baseConfig({ audit: { type: "console" } }));
    const result = await validateConfigFile(configPath);
    expect(result.warnings.some((w) => /audit\.type is "console"/.test(w))).toBe(true);
  });

  test("warning: 0.0.0.0 host", async () => {
    writeConfig(
      baseConfig({
        server: { host: "0.0.0.0", port: 18080, maxSessions: 10 },
        audit: { type: "console" },
      }),
    );
    const result = await validateConfigFile(configPath);
    expect(result.warnings.some((w) => /0\.0\.0\.0/.test(w))).toBe(true);
  });

  test("warning: overlap between allow_tools and exclude_tools", async () => {
    writeConfig(
      baseConfig({
        providers: [
          {
            type: "mcp",
            name: "everything",
            transport: "stdio",
            command: "node",
            args: [],
            env: {},
            allow_tools: ["echo", "shared"],
            exclude_tools: ["shared"],
          },
        ],
        audit: { type: "console" },
      }),
    );
    const result = await validateConfigFile(configPath);
    expect(result.warnings.some((w) => /both allow_tools and exclude_tools/.test(w))).toBe(true);
  });
});

describe("shipped example configs", () => {
  test.each([
    ["examples/minimal.json"],
    ["examples/multi-provider.json"],
    ["examples/conductor.json"],
  ])("%s parses with no errors", async (relPath) => {
    const result = await validateConfigFile(join(REPO_ROOT, relPath));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("formatValidationResult", () => {
  test("renders ok and warnings", () => {
    const out = formatValidationResult("/tmp/x.json", {
      ok: true,
      errors: [],
      warnings: ["w1"],
    });
    expect(out).toContain("✔ valid");
    expect(out).toContain("warning: w1");
  });

  test("renders errors", () => {
    const out = formatValidationResult("/tmp/x.json", {
      ok: false,
      errors: ["bad"],
      warnings: [],
    });
    expect(out).toContain("✘ invalid");
    expect(out).toContain("error: bad");
  });
});
