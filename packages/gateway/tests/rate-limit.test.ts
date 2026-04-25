import { describe, test, expect } from "vitest";
import { RateLimiter } from "../src/rate-limit.js";

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) { t += ms; },
  };
}

describe("RateLimiter", () => {
  test("disabled when maxPerMinute is 0 — every request passes", () => {
    const rl = new RateLimiter(0);
    for (let i = 0; i < 1000; i++) expect(rl.tryConsume("k")).toBe(true);
    expect(rl.remaining("k")).toBe(Number.POSITIVE_INFINITY);
  });

  test("permits up to budget then rejects", () => {
    const clock = fakeClock();
    const rl = new RateLimiter(3, clock.now);
    expect(rl.tryConsume("session-a")).toBe(true);
    expect(rl.tryConsume("session-a")).toBe(true);
    expect(rl.tryConsume("session-a")).toBe(true);
    expect(rl.tryConsume("session-a")).toBe(false);
  });

  test("buckets are isolated by key", () => {
    const clock = fakeClock();
    const rl = new RateLimiter(1, clock.now);
    expect(rl.tryConsume("a")).toBe(true);
    expect(rl.tryConsume("a")).toBe(false);
    expect(rl.tryConsume("b")).toBe(true);
  });

  test("budget refills after the 60s window elapses", () => {
    const clock = fakeClock();
    const rl = new RateLimiter(2, clock.now);
    expect(rl.tryConsume("k")).toBe(true);
    expect(rl.tryConsume("k")).toBe(true);
    expect(rl.tryConsume("k")).toBe(false);
    clock.advance(59_999);
    expect(rl.tryConsume("k")).toBe(false);
    clock.advance(2);
    expect(rl.tryConsume("k")).toBe(true);
    expect(rl.remaining("k")).toBe(1);
  });

  test("forget drops bucket state", () => {
    const clock = fakeClock();
    const rl = new RateLimiter(1, clock.now);
    rl.tryConsume("k");
    expect(rl.tryConsume("k")).toBe(false);
    rl.forget("k");
    expect(rl.tryConsume("k")).toBe(true);
  });
});
