import { describe, test, expect } from "vitest";
import { redactArgs } from "../../src/data/redact.js";

describe("redactArgs", () => {
  test("redacts default sensitive keys", () => {
    const json = redactArgs({ password: "p", secret: "s", token: "t", apiKey: "k", safe: "ok" });
    const parsed = JSON.parse(json);
    expect(parsed.password).toBe("[REDACTED]");
    expect(parsed.secret).toBe("[REDACTED]");
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.apiKey).toBe("[REDACTED]");
    expect(parsed.safe).toBe("ok");
  });

  test("redacts nested keys", () => {
    const json = redactArgs({ outer: { inner: { bearer: "b" }, data: 1 } });
    const parsed = JSON.parse(json);
    expect(parsed.outer.inner.bearer).toBe("[REDACTED]");
    expect(parsed.outer.data).toBe(1);
  });

  test("redacts inside arrays", () => {
    const json = redactArgs([{ password: "p" }, { safe: 1 }]);
    const parsed = JSON.parse(json);
    expect(parsed[0].password).toBe("[REDACTED]");
    expect(parsed[1].safe).toBe(1);
  });

  test("extraKeys honors custom sensitive list", () => {
    const json = redactArgs({ custom: "x", other: "y" }, { extraKeys: ["custom"] });
    const parsed = JSON.parse(json);
    expect(parsed.custom).toBe("[REDACTED]");
    expect(parsed.other).toBe("y");
  });

  test("truncates above maxBytes", () => {
    const big = { data: "x".repeat(10_000) };
    const json = redactArgs(big, { maxBytes: 100 });
    expect(json.length).toBeLessThan(200);
    expect(json).toContain("TRUNCATED");
  });

  test("handles circular structures without throwing", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => redactArgs(a)).not.toThrow();
    const json = redactArgs(a);
    expect(json).toContain("CIRCULAR");
  });
});
