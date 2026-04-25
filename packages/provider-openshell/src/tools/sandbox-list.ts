import { z } from "zod";
import type { ToolCallContext, ToolCallResult } from "@conductor/core";
import type { OpenShellClient } from "../openshell-client.js";
import type { OpenShellProviderOptions } from "../config.js";
import { jsonResult, textError, formatGrpcError } from "./util.js";

const MAX_LIMIT = 500;

const ArgsSchema = z
  .object({
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();

export async function handler(
  client: OpenShellClient,
  _options: OpenShellProviderOptions,
  rawArgs: unknown,
  _ctx: ToolCallContext,
): Promise<ToolCallResult> {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) return textError(`invalid args: ${parsed.error.message}`);

  const limit = Math.min(parsed.data.limit ?? 0, MAX_LIMIT);
  const offset = parsed.data.offset ?? 0;

  try {
    const response = await client.listSandboxes({ limit, offset });
    return jsonResult(response);
  } catch (err) {
    return textError(formatGrpcError("list-failed", err));
  }
}
