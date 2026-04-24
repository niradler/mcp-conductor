import { describe, test, expect, beforeEach } from "vitest";
import { ConsoleAuditStore } from "@mcp-conductor/core";
import type { ToolProvider } from "@mcp-conductor/core";
import { auditedProvider } from "../src/audit-wrapper.js";

const inner: ToolProvider = {
  name: "gh",
  async connect() {},
  async close() {},
  async listTools() { return []; },
  async callTool(name, args) {
    if (name === "boom") throw new Error("upstream-boom");
    return { content: [{ type: "text", text: JSON.stringify({ echoed: args }) }] };
  },
};

describe("audit-wrapper", () => {
  let store: ConsoleAuditStore;
  beforeEach(() => { store = new ConsoleAuditStore({ writer: () => {} }); });

  test("records a success row with redacted args", async () => {
    const wrapped = auditedProvider(inner, { store });
    await wrapped.callTool("echo", { text: "hello", apiKey: "SECRET" }, { user: "alice", requestId: "rq1" });
    const rows = await store.queryCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user: "alice", provider: "gh", tool: "echo", status: "success", requestId: "rq1" });
    expect(rows[0]!.args).toContain("REDACTED");
    expect(rows[0]!.args).not.toContain("SECRET");
    expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("records an error row when inner throws and rethrows", async () => {
    const wrapped = auditedProvider(inner, { store });
    await expect(wrapped.callTool("boom", {}, { user: "u" })).rejects.toThrow("upstream-boom");
    const rows = await store.queryCalls();
    expect(rows[0]).toMatchObject({ tool: "boom", status: "error" });
    expect(rows[0]!.error).toContain("upstream-boom");
  });

  test("records an error row when result.isError=true", async () => {
    const isErrorProv: ToolProvider = {
      ...inner,
      async callTool() { return { isError: true, content: [{ type: "text", text: "nope" }] }; },
    };
    const wrapped = auditedProvider(isErrorProv, { store });
    await wrapped.callTool("x", {}, { user: "u" });
    const rows = await store.queryCalls();
    expect(rows[0]).toMatchObject({ status: "error" });
  });
});
