import { z } from "zod";

/** openshell.sandbox.v1.L7Allow (subset). */
export const L7AllowSchema = z
  .object({
    method: z.string().optional(),
    path: z.string().optional(),
    command: z.string().optional(),
  })
  .strict();

/** openshell.sandbox.v1.NetworkEndpoint (subset — enough for MVP). */
export const NetworkEndpointSchema = z
  .object({
    host: z.string().optional(),
    ports: z.array(z.number().int().min(1).max(65535)).optional(),
    protocol: z.enum(["rest", "sql", ""]).optional(),
    access: z.enum(["read-only", "read-write", "full"]).optional(),
    rules: z.array(z.object({ allow: L7AllowSchema }).strict()).optional(),
  })
  .strict();

/** openshell.sandbox.v1.NetworkPolicyRule. */
export const NetworkPolicyRuleSchema = z
  .object({
    name: z.string(),
    endpoints: z.array(NetworkEndpointSchema).default([]),
    binaries: z.array(z.object({ path: z.string() }).strict()).default([]),
  })
  .strict();

/** openshell.sandbox.v1.SandboxPolicy. */
export const SandboxPolicySchema = z
  .object({
    version: z.number().int().nonnegative().default(1),
    filesystem: z
      .object({
        include_workdir: z.boolean().default(true),
        read_only: z.array(z.string()).default([]),
        read_write: z.array(z.string()).default([]),
      })
      .strict()
      .default({}),
    landlock: z
      .object({
        compatibility: z.enum(["best_effort", "hard_requirement"]).default("best_effort"),
      })
      .strict()
      .default({}),
    process: z
      .object({
        run_as_user: z.string().default(""),
        run_as_group: z.string().default(""),
      })
      .strict()
      .default({}),
    network_policies: z.record(NetworkPolicyRuleSchema).default({}),
  })
  .strict();

/** openshell.v1.SandboxTemplate. */
export const SandboxTemplateSchema = z
  .object({
    image: z.string(),
    runtime_class_name: z.string().optional(),
    environment: z.record(z.string()).optional(),
  })
  .strict();

/** openshell.v1.SandboxSpec (subset — only fields the provider sets). */
export const SandboxSpecSchema = z
  .object({
    log_level: z.string().default("info"),
    environment: z.record(z.string()).default({}),
    template: SandboxTemplateSchema,
    policy: SandboxPolicySchema,
    providers: z.array(z.string()).default([]),
    gpu: z.boolean().default(false),
  })
  .strict();

export type L7Allow = z.infer<typeof L7AllowSchema>;
export type NetworkEndpoint = z.infer<typeof NetworkEndpointSchema>;
export type NetworkPolicyRule = z.infer<typeof NetworkPolicyRuleSchema>;
export type SandboxPolicy = z.infer<typeof SandboxPolicySchema>;
export type SandboxTemplate = z.infer<typeof SandboxTemplateSchema>;
export type SandboxSpec = z.infer<typeof SandboxSpecSchema>;
