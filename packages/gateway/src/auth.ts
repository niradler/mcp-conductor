import { createHash, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "sha256:";

export function hashApiKey(plain: string): string {
  return HASH_PREFIX + createHash("sha256").update(plain).digest("hex");
}

export function verifyApiKey(plain: string, storedHash: string): boolean {
  if (!storedHash.startsWith(HASH_PREFIX)) return false;
  const expectedHex = storedHash.slice(HASH_PREFIX.length);
  if (expectedHex.length !== 64 || !/^[0-9a-f]+$/.test(expectedHex)) return false;
  const providedHex = createHash("sha256").update(plain).digest("hex");
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(providedHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function extractBearer(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  return m && m[1] ? m[1].trim() : null;
}
