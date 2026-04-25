import { z } from "zod";
import type { ToolCallContext, ToolCallResult } from "@conductor/core";
import type { OpenShellClient } from "../openshell-client.js";
import type { OpenShellProviderOptions } from "../config.js";
import { isInvalidName, jsonResult, textError, formatGrpcError } from "./util.js";

const ArgsSchema = z
  .object({
    name: z.string(),
    version: z.number().int().nonnegative().optional(),
  })
  .strict();

export async function handler(
  client: OpenShellClient,
  options: OpenShellProviderOptions,
  rawArgs: unknown,
  _ctx: ToolCallContext,
): Promise<ToolCallResult> {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) return textError(`invalid args: ${parsed.error.message}`);

  const { name, version } = parsed.data;
  if (isInvalidName(options.sandboxNamePattern, name)) {
    return textError(`invalid sandbox name: ${JSON.stringify(name)}`);
  }

  try {
    const response = await client.getSandboxPolicyStatus({
      name,
      version: version ?? 0,
      global: false,
    });
    return jsonResult(response);
  } catch (err) {
    return textError(formatGrpcError("policy-status-failed", err));
  }
}
