import { z } from "zod";
import { GatewayConfigSchema } from "@conductor/gateway";

export const McpProviderEntrySchema = z.object({
  type: z.literal("mcp"),
  name: z.string(),
  transport: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  initialListTimeoutMs: z.number().int().positive().optional(),
  callTimeoutMs: z.number().int().positive().optional(),
  reconnect: z
    .object({
      maxAttempts: z.number().int().positive().optional(),
      initialDelayMs: z.number().int().positive().optional(),
      maxDelayMs: z.number().int().positive().optional(),
    })
    .optional(),
  /** Only expose tools whose names match one of these exact names or glob patterns (e.g. "sandbox_*"). */
  allow_tools: z.array(z.string()).optional(),
  /** Always hide tools whose names match one of these patterns. Applied after allow_tools. */
  exclude_tools: z.array(z.string()).optional(),
  /** Tool argument keys whose values are replaced with [REDACTED] in audit records (in addition to the built-in sensitive-key list). */
  redact_fields: z.array(z.string()).optional(),
});

/**
 * Single-variant discriminated union. Keeping it as a union (rather than a bare object)
 * leaves the door open for future provider types (`openapi`, `graphql`, etc.) without
 * changing the public shape of `ProviderEntry`.
 */
export const ProviderEntrySchema = z.discriminatedUnion("type", [McpProviderEntrySchema]);

export const AuditConfigSchema = z.object({
  type: z.literal("console"),
  bufferSize: z.number().int().positive().optional(),
});

export const TelemetryConfigSchema = z
  .object({
    serviceName: z.string().default("conductor"),
    otlpEndpoint: z.string().default(""),
  })
  .default({});

/** Top-level conductor.json shape. Reuses the gateway's users/groups/server schema. */
export const ConductorConfigSchema = GatewayConfigSchema.extend({
  providers: z.array(ProviderEntrySchema).min(1),
  audit: AuditConfigSchema,
  telemetry: TelemetryConfigSchema,
}).strict();

export type ConductorConfig = z.output<typeof ConductorConfigSchema>;
export type ProviderEntry = z.output<typeof ProviderEntrySchema>;
export type McpProviderEntry = z.output<typeof McpProviderEntrySchema>;
export type AuditConfig = z.output<typeof AuditConfigSchema>;
