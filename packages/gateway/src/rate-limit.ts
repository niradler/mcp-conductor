/**
 * Per-key minute-window rate limiter.
 *
 * Each key has a budget of `maxPerMinute` requests. The budget refills to full
 * once the previous window (60s wall clock) elapses since the first consume.
 * Coarser than a token bucket, but sufficient for abuse prevention and easier
 * to reason about (no fractional refill state).
 */
const WINDOW_MS = 60_000;

interface Bucket {
  remaining: number;
  windowStart: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(public readonly maxPerMinute: number, private readonly now: () => number = Date.now) {}

  /** Returns true if a request from `key` is allowed, decrementing its budget. */
  tryConsume(key: string): boolean {
    if (this.maxPerMinute <= 0) return true; // disabled
    const t = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || t - bucket.windowStart >= WINDOW_MS) {
      this.buckets.set(key, { remaining: this.maxPerMinute - 1, windowStart: t });
      return true;
    }
    if (bucket.remaining <= 0) return false;
    bucket.remaining -= 1;
    return true;
  }

  /** Drop bucket state for a key (e.g., when a session closes). */
  forget(key: string): void {
    this.buckets.delete(key);
  }

  /** Inspect remaining budget without consuming. Returns `maxPerMinute` if no bucket exists yet. */
  remaining(key: string): number {
    if (this.maxPerMinute <= 0) return Number.POSITIVE_INFINITY;
    const bucket = this.buckets.get(key);
    if (!bucket || this.now() - bucket.windowStart >= WINDOW_MS) return this.maxPerMinute;
    return bucket.remaining;
  }
}
