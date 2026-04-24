import { describe, test, expect } from "vitest";
import { hashApiKey, verifyApiKey, extractBearer } from "../src/auth.js";

describe("auth", () => {
  test("hashApiKey produces sha256:<64 hex>", () => {
    const h = hashApiKey("plain-key");
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  test("verify returns true for matching plaintext", () => {
    const h = hashApiKey("secret");
    expect(verifyApiKey("secret", h)).toBe(true);
  });
  test("verify returns false for mismatched plaintext", () => {
    const h = hashApiKey("secret");
    expect(verifyApiKey("wrong", h)).toBe(false);
  });
  test("verify returns false for malformed hash", () => {
    expect(verifyApiKey("secret", "sha1:abc")).toBe(false);
    expect(verifyApiKey("secret", "sha256:short")).toBe(false);
  });
  test("extractBearer returns token from Authorization header", () => {
    expect(extractBearer("Bearer abc.def")).toBe("abc.def");
    expect(extractBearer("bearer abc")).toBe("abc");
  });
  test("extractBearer returns null for missing/invalid", () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer("Basic user:pass")).toBeNull();
  });
});
