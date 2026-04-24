import { describe, test, expect } from "vitest";
import { ConductorConfigSchema } from "../src/conductor-config.js";

const base = {
  server: { port: 3000 },
  users: [{ name: "a", apiKeyHash: "sha256:" + "a".repeat(64), groups: ["admin"] }],
  groups: [{ name: "admin", providers: ["*"] }],
  providers: [
    { type: "mcp", name: "gh", transport: "stdio", command: "node", args: ["stub.js"] },
  ],
  audit: { type: "console" },
  telemetry: { serviceName: "x", otlpEndpoint: "" },
};

describe("ConductorConfigSchema", () => {
  test("accepts minimal complete config", () => {
    const parsed = ConductorConfigSchema.parse(base);
    expect(parsed.providers).toHaveLength(1);
    expect(parsed.audit.type).toBe("console");
  });

  test("rejects unknown provider type", () => {
    expect(() =>
      ConductorConfigSchema.parse({ ...base, providers: [{ type: "openapi", name: "x" }] }),
    ).toThrow();
  });

  test("rejects sandbox provider (sandbox excluded from this build)", () => {
    expect(() =>
      ConductorConfigSchema.parse({
        ...base,
        providers: [{ type: "sandbox", name: "sb" }],
      }),
    ).toThrow();
  });

  test("rejects unknown audit type", () => {
    expect(() => ConductorConfigSchema.parse({ ...base, audit: { type: "jsonl" } })).toThrow();
  });

  test("rejects extra top-level keys", () => {
    expect(() => ConductorConfigSchema.parse({ ...base, unknown: true })).toThrow();
  });
});
