import { describe, test, expect } from "vitest";
import { ok, err } from "../src/types/shared.js";
import { ConfigError, ProviderError, SandboxError } from "../src/errors/index.js";

describe("shared", () => {
  test("ok/err", () => {
    const a = ok(42);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value).toBe(42);

    const b = err("x");
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toBe("x");
  });

  test("error classes carry fields", () => {
    expect(new ConfigError("m", "p").path).toBe("p");
    expect(new ProviderError("m", "github").provider).toBe("github");
    expect(new SandboxError("m", "timeout").errorType).toBe("timeout");
  });
});
