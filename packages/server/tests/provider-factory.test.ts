import { describe, test, expect } from "vitest";
import { createProvider } from "../src/provider-factory.js";

describe("createProvider", () => {
  test("creates McpProvider for type=mcp", () => {
    const p = createProvider({
      type: "mcp",
      name: "gh",
      transport: "stdio",
      command: "node",
      args: ["stub.js"],
      env: {},
    });
    expect(p.name).toBe("gh");
  });

  test("applies default reconnect settings when not provided", () => {
    const p = createProvider({
      type: "mcp",
      name: "gh2",
      transport: "stdio",
      command: "node",
      args: [],
      env: {},
    });
    expect(p.name).toBe("gh2");
  });

  test("accepts custom timeouts and reconnect overrides", () => {
    const p = createProvider({
      type: "mcp",
      name: "gh3",
      transport: "stdio",
      command: "node",
      args: [],
      env: {},
      initialListTimeoutMs: 5_000,
      callTimeoutMs: 10_000,
      reconnect: { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 1_000 },
    });
    expect(p.name).toBe("gh3");
  });
});
