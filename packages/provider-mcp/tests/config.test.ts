import { describe, test, expect } from "vitest";
import { McpProviderOptionsSchema } from "../src/config.js";

describe("McpProviderOptionsSchema", () => {
  test("accepts minimal config", () => {
    const p = McpProviderOptionsSchema.parse({
      name: "gh",
      transport: "stdio",
      command: "node",
    });
    expect(p.name).toBe("gh");
    expect(p.args).toEqual([]);
  });
  test("rejects __ in name", () => {
    expect(() =>
      McpProviderOptionsSchema.parse({ name: "a__b", transport: "stdio", command: "x" }),
    ).toThrow();
  });
  test("rejects invalid transport", () => {
    expect(() =>
      McpProviderOptionsSchema.parse({ name: "x", transport: "http", command: "y" }),
    ).toThrow();
  });
  test("rejects extra keys", () => {
    expect(() =>
      McpProviderOptionsSchema.parse({
        name: "x",
        transport: "stdio",
        command: "y",
        extra: 1,
      }),
    ).toThrow();
  });
});
