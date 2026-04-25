import type { GatewayConfig, GatewayUser } from "./config.js";

/** Returns the set of provider names a user can reach. "*" expands to all configured provider names. */
export function providersForUser(cfg: GatewayConfig, user: GatewayUser, allProviders: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const groupName of user.groups) {
    const group = cfg.groups.find((g) => g.name === groupName);
    if (!group) continue;
    for (const p of group.providers) {
      if (p === "*") { for (const n of allProviders) out.add(n); }
      else out.add(p);
    }
  }
  return out;
}

export function userCanCallProvider(cfg: GatewayConfig, user: GatewayUser, providerName: string, allProviders: readonly string[]): boolean {
  return providersForUser(cfg, user, allProviders).has(providerName);
}
