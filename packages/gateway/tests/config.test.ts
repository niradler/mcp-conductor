import { describe, test, expect } from "vitest";
import { GatewayConfigSchema, validateGatewayConfig } from "../src/config.js";
import { ConfigError } from "@conductor/core";

const base = {
  server: { port: 3000 },
  users: [{ name: "a", apiKeyHash: "sha256:" + "a".repeat(64), groups: ["admin"] }],
  groups: [{ name: "admin", providers: ["*"] }],
};

describe("GatewayConfigSchema", () => {
  test("accepts a minimal valid config", () => {
    const cfg = GatewayConfigSchema.parse(base);
    expect(cfg.users).toHaveLength(1);
  });
  test("rejects short apiKeyHash", () => {
    expect(() => GatewayConfigSchema.parse({ ...base, users: [{ ...base.users[0], apiKeyHash: "sha256:abc" }] })).toThrow();
  });
  test("rejects unknown keys", () => {
    expect(() => GatewayConfigSchema.parse({ ...base, extra: 1 })).toThrow();
  });
});

describe("validateGatewayConfig", () => {
  test("passes when references are valid", () => {
    const cfg = GatewayConfigSchema.parse({ ...base, groups: [{ name: "admin", providers: ["gh"] }] });
    expect(() => validateGatewayConfig(cfg, ["gh"])).not.toThrow();
  });
  test("throws when user references unknown group", () => {
    const cfg = GatewayConfigSchema.parse({ ...base, users: [{ ...base.users[0], groups: ["ghost"] }] });
    expect(() => validateGatewayConfig(cfg, [])).toThrow(ConfigError);
  });
  test("throws when group references unknown provider", () => {
    const cfg = GatewayConfigSchema.parse({ ...base, groups: [{ name: "admin", providers: ["ghost"] }] });
    expect(() => validateGatewayConfig(cfg, ["gh"])).toThrow(ConfigError);
  });
  test("wildcard providers are fine even if no providers exist", () => {
    const cfg = GatewayConfigSchema.parse(base);
    expect(() => validateGatewayConfig(cfg, [])).not.toThrow();
  });
  test("duplicate user names rejected", () => {
    const cfg = GatewayConfigSchema.parse({ ...base, users: [base.users[0], { ...base.users[0] }] });
    expect(() => validateGatewayConfig(cfg, [])).toThrow(/duplicate user/);
  });
});
