import { z } from "zod";

export const McpProviderOptionsSchema = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
    .refine((v) => !v.includes("__"), "name must not contain __"),
  transport: z.literal("stdio"), // Stage 1: stdio only
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  initialListTimeoutMs: z.number().int().positive().default(15_000),
  callTimeoutMs: z.number().int().positive().default(60_000),
  reconnect: z
    .object({
      maxAttempts: z.number().int().positive().default(10),
      initialDelayMs: z.number().int().positive().default(1_000),
      maxDelayMs: z.number().int().positive().default(30_000),
    })
    .default({}),
}).strict();

export type McpProviderOptions = z.infer<typeof McpProviderOptionsSchema>;
