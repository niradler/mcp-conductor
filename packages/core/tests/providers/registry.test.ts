import { describe, test, expect } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { ProviderError } from "../../src/errors/index.js";
import type { ToolProvider } from "../../src/providers/tool-provider.js";

function makeStub(name: string): ToolProvider {
  return {
    name,
    async connect() {},
    async close() {},
    async listTools() {
      return [];
    },
    async callTool() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
}

describe("ProviderRegistry", () => {
  test("register + get + require", () => {
    const r = new ProviderRegistry();
    const p = makeStub("github");
    r.register(p);
    expect(r.get("github")).toBe(p);
    expect(r.require("github")).toBe(p);
    expect(r.names()).toEqual(["github"]);
  });

  test("duplicate names rejected", () => {
    const r = new ProviderRegistry();
    r.register(makeStub("x"));
    expect(() => r.register(makeStub("x"))).toThrow(ProviderError);
  });

  test("names with __ rejected", () => {
    const r = new ProviderRegistry();
    expect(() => r.register(makeStub("a__b"))).toThrow(/must not contain "__"/);
  });

  test("invalid name charset rejected", () => {
    const r = new ProviderRegistry();
    expect(() => r.register(makeStub("has space"))).toThrow(/invalid provider name/);
  });

  test("require unknown throws", () => {
    expect(() => new ProviderRegistry().require("x")).toThrow(ProviderError);
  });

  test("connectAll and closeAll iterate every provider", async () => {
    const r = new ProviderRegistry();
    const calls: string[] = [];
    r.register({
      ...makeStub("a"),
      connect: async () => {
        calls.push("a:c");
      },
      close: async () => {
        calls.push("a:x");
      },
    });
    r.register({
      ...makeStub("b"),
      connect: async () => {
        calls.push("b:c");
      },
      close: async () => {
        calls.push("b:x");
      },
    });
    await r.connectAll();
    await r.closeAll();
    expect(calls).toEqual(["a:c", "b:c", "a:x", "b:x"]);
  });
});
