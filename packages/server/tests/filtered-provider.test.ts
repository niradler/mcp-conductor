import { describe, test, expect } from "vitest";
import type { ToolProvider, ToolSpec } from "@conductor/core";
import { filteredProvider } from "../src/filtered-provider.js";

function makeStub(tools: ToolSpec[]): ToolProvider {
  return {
    name: "stub",
    connect: async () => {},
    close: async () => {},
    listTools: async () => tools,
    callTool: async () => ({ content: [], isError: false }),
  };
}

const ALL_TOOLS: ToolSpec[] = [
  { name: "echo", description: "echo", inputSchema: {} },
  { name: "sandbox_exec", description: "exec", inputSchema: {} },
  { name: "sandbox_logs", description: "logs", inputSchema: {} },
  { name: "policy_set", description: "policy", inputSchema: {} },
];

describe("filteredProvider", () => {
  test("should return inner provider unchanged when no filter is specified", () => {
    const inner = makeStub(ALL_TOOLS);
    expect(filteredProvider(inner, {})).toBe(inner);
    expect(filteredProvider(inner, { allowTools: [] })).toBe(inner);
    expect(filteredProvider(inner, { excludeTools: [] })).toBe(inner);
  });

  test("should expose only exact matches when allow_tools has exact names", async () => {
    const wrapped = filteredProvider(makeStub(ALL_TOOLS), { allowTools: ["echo", "policy_set"] });
    const tools = await wrapped.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "policy_set"]);
  });

  test("should support glob pattern in allow_tools", async () => {
    const wrapped = filteredProvider(makeStub(ALL_TOOLS), { allowTools: ["sandbox_*"] });
    const tools = await wrapped.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["sandbox_exec", "sandbox_logs"]);
  });

  test("should exclude exact matches in exclude_tools", async () => {
    const wrapped = filteredProvider(makeStub(ALL_TOOLS), { excludeTools: ["echo"] });
    const tools = await wrapped.listTools();
    expect(tools.map((t) => t.name)).not.toContain("echo");
    expect(tools).toHaveLength(3);
  });

  test("should support glob pattern in exclude_tools", async () => {
    const wrapped = filteredProvider(makeStub(ALL_TOOLS), { excludeTools: ["sandbox_*"] });
    const tools = await wrapped.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "policy_set"]);
  });

  test("should apply exclude_tools after allow_tools", async () => {
    const wrapped = filteredProvider(makeStub(ALL_TOOLS), {
      allowTools: ["sandbox_*", "echo"],
      excludeTools: ["sandbox_logs"],
    });
    const tools = await wrapped.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "sandbox_exec"]);
  });

  test("should preserve provider name", () => {
    const inner = makeStub(ALL_TOOLS);
    const wrapped = filteredProvider(inner, { allowTools: ["echo"] });
    expect(wrapped.name).toBe("stub");
  });

  test("should delegate callTool to inner provider", async () => {
    let called = false;
    const inner: ToolProvider = {
      name: "stub",
      connect: async () => {},
      close: async () => {},
      listTools: async () => ALL_TOOLS,
      callTool: async () => { called = true; return { content: [], isError: false }; },
    };
    const wrapped = filteredProvider(inner, { allowTools: ["echo"] });
    await wrapped.callTool("echo", {}, { user: "alice", requestId: "r1" });
    expect(called).toBe(true);
  });
});
