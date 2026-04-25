import { z } from "zod";

const PemSource = z.union([z.string().min(1), z.instanceof(Buffer)]);

export const TlsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("insecure") }),
  z.object({ mode: z.literal("tls"), ca: PemSource }),
  z.object({ mode: z.literal("mtls"), ca: PemSource, cert: PemSource, key: PemSource }),
]);

export const TimeoutsSchema = z
  .object({
    connect: z.number().int().positive().default(15_000),
    create: z.number().int().positive().default(120_000),
    destroy: z.number().int().positive().default(60_000),
    exec: z.number().int().positive().default(120_000),
    list: z.number().int().positive().default(15_000),
    get: z.number().int().positive().default(15_000),
    logs: z.number().int().positive().default(15_000),
    policySet: z.number().int().positive().default(60_000),
    policyStatus: z.number().int().positive().default(15_000),
  })
  .default({});

export const OpenShellProviderOptionsSchema = z
  .object({
    name: z.string().default("openshell"),
    endpoint: z.string().min(1),
    tls: TlsSchema.default({ mode: "insecure" }),
    timeouts: TimeoutsSchema,
    /** Pattern applied client-side before RPC. Server validates too; this is defense in depth + fast-fail UX. */
    sandboxNamePattern: z.string().default("^[a-zA-Z0-9_-]{1,64}$"),
  })
  .strict();

export type OpenShellProviderOptions = z.infer<typeof OpenShellProviderOptionsSchema>;
export type TlsOptions = z.infer<typeof TlsSchema>;
export type TlsConfig = z.infer<typeof TlsSchema>;
export type Timeouts = z.infer<typeof TimeoutsSchema>;
