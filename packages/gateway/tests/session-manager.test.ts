import { describe, test, expect, vi } from "vitest";
import { SessionManager } from "../src/session-manager.js";

const logStub = { info: vi.fn(), warn: vi.fn() };

describe("SessionManager", () => {
  test("evicts oldest when over capacity and closes resources", async () => {
    const closed: string[] = [];
    const closers = {
      closeMcp: async (m: { id: string }) => { closed.push(`m:${m.id}`); },
      closeTransport: async (t: { id: string }) => { closed.push(`t:${t.id}`); },
    };
    const sm = new SessionManager<{ id: string }, { id: string }>(2, closers, logStub);
    for (let i = 0; i < 3; i++) {
      await sm.add({ id: `s${i}`, user: "u", mcp: { id: `s${i}` }, transport: { id: `s${i}` }, createdAt: Date.now() + i });
    }
    expect(sm.size()).toBe(2);
    expect(closed).toEqual(["m:s0", "t:s0"]);
  });

  test("remove is a no-op for unknown id", async () => {
    const sm = new SessionManager<Record<string, never>, Record<string, never>>(
      5,
      { closeMcp: async () => {}, closeTransport: async () => {} },
      logStub,
    );
    await expect(sm.remove("nope")).resolves.toBeUndefined();
  });

  test("closeAll empties", async () => {
    const sm = new SessionManager<Record<string, never>, Record<string, never>>(
      5,
      { closeMcp: async () => {}, closeTransport: async () => {} },
      logStub,
    );
    await sm.add({ id: "a", user: "u", mcp: {}, transport: {}, createdAt: 1 });
    await sm.add({ id: "b", user: "u", mcp: {}, transport: {}, createdAt: 2 });
    await sm.closeAll();
    expect(sm.size()).toBe(0);
  });
});
