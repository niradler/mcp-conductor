import { describe, test, expect } from "vitest";
import { createAuditStore } from "../src/audit-factory.js";

describe("createAuditStore", () => {
  test("returns a ConsoleAuditStore for type=console", async () => {
    const store = createAuditStore({ type: "console" });
    await store.insertCall({
      ts: new Date().toISOString(),
      user: "u",
      provider: "p",
      tool: "t",
      args: "{}",
      status: "success",
      durationMs: 1,
    });
    expect(await store.count()).toBe(1);
    await store.close();
  });

  test("respects bufferSize", async () => {
    const store = createAuditStore({ type: "console", bufferSize: 2 });
    for (let i = 0; i < 5; i++) {
      await store.insertCall({
        ts: new Date(Date.now() + i).toISOString(),
        user: "u",
        provider: "p",
        tool: `t${i}`,
        args: "{}",
        status: "success",
        durationMs: 1,
      });
    }
    expect(await store.count()).toBe(2);
    await store.close();
  });
});
