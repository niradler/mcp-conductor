import { describe, test, expect, vi } from "vitest";
import { createShutdownRegistry } from "../../src/lifecycle/shutdown.js";

const silentLogger = { info: vi.fn(), error: vi.fn() };

describe("shutdown registry", () => {
  test("LIFO order", async () => {
    const calls: string[] = [];
    const r = createShutdownRegistry({ registerSignals: false, logger: silentLogger });
    r.register("a", async () => {
      calls.push("a");
    });
    r.register("b", async () => {
      calls.push("b");
    });
    r.register("c", async () => {
      calls.push("c");
    });
    await r.shutdown("t");
    expect(calls).toEqual(["c", "b", "a"]);
  });

  test("continues past throws", async () => {
    const calls: string[] = [];
    const r = createShutdownRegistry({ registerSignals: false, logger: silentLogger });
    r.register("g1", async () => {
      calls.push("g1");
    });
    r.register("bad", async () => {
      throw new Error("x");
    });
    r.register("g2", async () => {
      calls.push("g2");
    });
    await r.shutdown("t");
    expect(calls).toEqual(["g2", "g1"]);
  });

  test("idempotent", async () => {
    const spy = vi.fn(async () => {});
    const r = createShutdownRegistry({ registerSignals: false, logger: silentLogger });
    r.register("x", spy);
    await r.shutdown("t");
    await r.shutdown("t");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
