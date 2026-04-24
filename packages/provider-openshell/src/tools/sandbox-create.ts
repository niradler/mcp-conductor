import { z } from "zod";
import type { ToolCallContext, ToolCallResult } from "@mcp-conductor/core";
import type { OpenShellClient } from "../openshell-client.js";
import type { OpenShellProviderOptions } from "../config.js";
import { SandboxSpecSchema } from "../types.js";
import { isInvalidName, jsonResult, textError, formatGrpcError } from "./util.js";

const ArgsSchema = z
  .object({
    name: z.string().optional(),
    spec: SandboxSpecSchema,
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

  const { name, spec } = parsed.data;
  if (name !== undefined && isInvalidName(options.sandboxNamePattern, name)) {
    return textError(`invalid sandbox name: ${JSON.stringify(name)}`);
  }

  try {
    const response = await client.createSandbox({ name: name ?? "", spec });
    return jsonResult(response);
  } catch (err) {
    return textError(formatGrpcError("create-failed", err));
  }
}
