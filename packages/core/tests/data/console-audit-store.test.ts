import { describe, test, expect, beforeEach } from "vitest";
import { ConsoleAuditStore } from "../../src/data/console-audit-store.js";
import type { AuditCall } from "../../src/data/audit-store.js";

function row(ts: string, over: Record<string, unknown> = {}) {
  return {
    ts,
    user: "alice",
    provider: "github",
    tool: "t",
    args: "{}",
    status: "success" as const,
    durationMs: 1,
    ...over,
  };
}

describe("ConsoleAuditStore", () => {
  let lines: string[];
  let store: ConsoleAuditStore;

  beforeEach(() => {
    lines = [];
    store = new ConsoleAuditStore({ writer: (l) => lines.push(l) });
  });

  test("insert returns increasing ids", async () => {
    const a = await store.insertCall(row(new Date().toISOString()));
    const b = await store.insertCall(row(new Date().toISOString()));
    expect(b).toBe(a + 1);
  });

  test("emits JSON line with expected audit fields", async () => {
    const ts = new Date().toISOString();
    await store.insertCall(row(ts, { user: "bob", requestId: "r-1" }));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as AuditCall & { kind: string };
    expect(parsed.kind).toBe("audit");
    expect(parsed).toMatchObject({
      user: "bob",
      provider: "github",
      tool: "t",
      status: "success",
      requestId: "r-1",
    });
    expect(typeof parsed.id).toBe("number");
  });

  test("query filters by user/status/provider/requestId", async () => {
    const ts = new Date().toISOString();
    await store.insertCall(row(ts, { user: "alice" }));
    await store.insertCall(row(ts, { user: "bob", status: "error", error: "boom" }));
    await store.insertCall(row(ts, { user: "carol", provider: "slack", requestId: "r1" }));
    expect((await store.queryCalls({ user: "alice" })).length).toBe(1);
    expect((await store.queryCalls({ status: "error" })).length).toBe(1);
    expect((await store.queryCalls({ provider: "slack" })).length).toBe(1);
    expect((await store.queryCalls({ requestId: "r1" })).length).toBe(1);
  });

  test("orders DESC by ts and respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.insertCall(row(new Date(Date.now() + i * 1000).toISOString()));
    }
    const got = await store.queryCalls({ limit: 3 });
    expect(got).toHaveLength(3);
    expect(new Date(got[0]!.ts).getTime()).toBeGreaterThan(new Date(got[2]!.ts).getTime());
  });

  test("ring buffer evicts oldest past bufferSize", async () => {
    const small = new ConsoleAuditStore({ writer: () => {}, bufferSize: 3 });
    for (let i = 0; i < 5; i++) {
      await small.insertCall(row(new Date(Date.now() + i).toISOString(), { tool: `t${i}` }));
    }
    expect(await small.count()).toBe(3);
    const recent = await small.queryCalls();
    const tools = recent.map((r) => r.tool).sort();
    expect(tools).toEqual(["t2", "t3", "t4"]);
  });

  test("count respects filters", async () => {
    const ts = new Date().toISOString();
    await store.insertCall(row(ts, { user: "a" }));
    await store.insertCall(row(ts, { user: "b" }));
    expect(await store.count()).toBe(2);
    expect(await store.count({ user: "a" })).toBe(1);
  });
});
