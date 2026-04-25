import * as grpc from "@grpc/grpc-js";
import { z } from "zod";
import type { ToolCallContext, ToolCallResult } from "@mcp-conductor/core";
import type { OpenShellClient } from "../openshell-client.js";
import type { OpenShellProviderOptions } from "../config.js";
import { isInvalidName, jsonResult, textError, formatGrpcError } from "./util.js";

const DEFAULT_LINES = 500;
const MAX_LINES = 10_000;

const ArgsSchema = z
  .object({
    name: z.string(),
    lines: z.number().int().positive().optional(),
    sinceMs: z.number().int().nonnegative().optional(),
  })
  .strict();

interface SandboxLite {
  id?: string;
}
interface SandboxResponseLite {
  sandbox?: SandboxLite;
}

function isGrpcError(err: unknown, code: number): boolean {
  return typeof (err as { code?: number }).code === "number" && (err as { code: number }).code === code;
}

export async function handler(
  client: OpenShellClient,
  options: OpenShellProviderOptions,
  rawArgs: unknown,
  _ctx: ToolCallContext,
): Promise<ToolCallResult> {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) return textError(`invalid args: ${parsed.error.message}`);

  const { name, lines, sinceMs } = parsed.data;
  if (isInvalidName(options.sandboxNamePattern, name)) {
    return textError(`invalid sandbox name: ${JSON.stringify(name)}`);
  }

  let lookup: SandboxResponseLite;
  try {
    lookup = (await client.getSandbox({ name })) as SandboxResponseLite;
  } catch (err) {
    if (isGrpcError(err, grpc.status.NOT_FOUND)) {
      return textError(`sandbox not found: ${name}`);
    }
    return textError(formatGrpcError("logs-lookup-failed", err));
  }

  const sandboxId = lookup.sandbox?.id;
  if (!sandboxId) {
    return textError(`sandbox not found: ${name}`);
  }

  const effectiveLines = Math.min(lines ?? DEFAULT_LINES, MAX_LINES);

  try {
    const response = await client.getSandboxLogs({
      sandbox_id: sandboxId,
      lines: effectiveLines,
      since_ms: sinceMs ?? 0,
    });
    return jsonResult(response);
  } catch (err) {
    return textError(formatGrpcError("logs-failed", err));
  }
}
