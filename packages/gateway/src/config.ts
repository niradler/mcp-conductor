import { z } from "zod";
import { ConfigError } from "@mcp-conductor/core";

export const UserSchema = z.object({
  name: z.string().min(1),
  apiKeyHash: z.string().regex(/^sha256:[0-9a-f]{64}$/, "apiKeyHash must be 'sha256:<64 hex chars>'"),
  groups: z.array(z.string()).min(1),
});

export const GroupSchema = z.object({
  name: z.string().min(1),
  /** List of provider names, or ["*"] for all. */
  providers: z.array(z.string()).min(1),
});

export const ServerSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().int().nonnegative().default(3000),
  maxSessions: z.number().int().positive().default(100),
}).default({});

export const GatewayConfigSchema = z.object({
  server: ServerSchema,
  users: z.array(UserSchema).min(1),
  groups: z.array(GroupSchema).min(1),
}).strict();

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type GatewayUser = z.infer<typeof UserSchema>;
export type GatewayGroup = z.infer<typeof GroupSchema>;

/** Validate that every user's groups exist, and every group's providers exist (unless "*"). */
export function validateGatewayConfig(cfg: GatewayConfig, providerNames: readonly string[]): void {
  const groupNames = new Set(cfg.groups.map((g) => g.name));
  const providers = new Set(providerNames);
  for (const u of cfg.users) {
    for (const g of u.groups) {
      if (!groupNames.has(g)) throw new ConfigError(`user "${u.name}" references unknown group "${g}"`);
    }
  }
  for (const g of cfg.groups) {
    for (const p of g.providers) {
      if (p === "*") continue;
      if (!providers.has(p)) throw new ConfigError(`group "${g.name}" references unknown provider "${p}"`);
    }
  }
  const seenUsers = new Set<string>();
  for (const u of cfg.users) {
    if (seenUsers.has(u.name)) throw new ConfigError(`duplicate user name: ${u.name}`);
    seenUsers.add(u.name);
  }
  const seenGroups = new Set<string>();
  for (const g of cfg.groups) {
    if (seenGroups.has(g.name)) throw new ConfigError(`duplicate group name: ${g.name}`);
    seenGroups.add(g.name);
  }
}
