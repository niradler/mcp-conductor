import { describe, test, expect, vi } from "vitest";
import { createLogger } from "../src/logger/index.js";

function captureStderr() {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => {
    logs.push(String(m));
  });
  return { logs, restore: () => spy.mockRestore() };
}

describe("logger", () => {
  test("emits JSON line with level/scope/msg/ctx", () => {
    const { logs, restore } = captureStderr();
    createLogger("test", "info").info("hi", { k: 1 });
    const e = JSON.parse(logs[0]!);
    expect(e).toMatchObject({ level: "info", scope: "test", msg: "hi", k: 1 });
    expect(typeof e.ts).toBe("string");
    restore();
  });

  test("filters below level", () => {
    const { logs, restore } = captureStderr();
    const log = createLogger("t", "warn");
    log.debug("x");
    log.info("x");
    log.warn("keep");
    log.error("keep");
    expect(logs).toHaveLength(2);
    restore();
  });

  test("serializes Error", () => {
    const { logs, restore } = captureStderr();
    createLogger("t", "error").error("boom", { err: new Error("x") });
    const e = JSON.parse(logs[0]!);
    expect(e.err).toMatchObject({ name: "Error", message: "x" });
    restore();
  });

  test("child joins scope with dot", () => {
    const { logs, restore } = captureStderr();
    createLogger("p", "info").child("c").info("hi");
    expect(JSON.parse(logs[0]!).scope).toBe("p.c");
    restore();
  });
});
