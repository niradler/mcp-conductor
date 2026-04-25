import { describe, test, expect } from "vitest";
import { GatewayConfigSchema } from "../src/config.js";
import { providersForUser, userCanCallProvider } from "../src/access-control.js";

const cfg = GatewayConfigSchema.parse({
  server: {},
  users: [
    { name: "alice", apiKeyHash: "sha256:" + "a".repeat(64), groups: ["admin"] },
    { name: "bob", apiKeyHash: "sha256:" + "b".repeat(64), groups: ["dev"] },
  ],
  groups: [
    { name: "admin", providers: ["*"] },
    { name: "dev", providers: ["gh", "sandbox"] },
  ],
});

describe("access-control", () => {
  test("admin sees all via *", () => {
    const s = providersForUser(cfg, cfg.users[0]!, ["gh", "sandbox", "slack"]);
    expect([...s].sort()).toEqual(["gh", "sandbox", "slack"]);
  });
  test("dev sees whitelisted only", () => {
    const s = providersForUser(cfg, cfg.users[1]!, ["gh", "sandbox", "slack"]);
    expect([...s].sort()).toEqual(["gh", "sandbox"]);
  });
  test("userCanCallProvider returns true/false correctly", () => {
    expect(userCanCallProvider(cfg, cfg.users[1]!, "gh", ["gh", "slack"])).toBe(true);
    expect(userCanCallProvider(cfg, cfg.users[1]!, "slack", ["gh", "slack"])).toBe(false);
  });
});
