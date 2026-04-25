import { z } from "zod";
import type { ToolCallContext, ToolCallResult } from "@conductor/core";
import type { OpenShellClient } from "../openshell-client.js";
import type { OpenShellProviderOptions } from "../config.js";
import { isInvalidName, textResult, textError, formatGrpcError } from "./util.js";

const ArgsSchema = z.object({ name: z.string() }).strict();

export async function handler(
  client: OpenShellClient,
  options: OpenShellProviderOptions,
  rawArgs: unknown,
  _ctx: ToolCallContext,
): Promise<ToolCallResult> {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) return textError(`invalid args: ${parsed.error.message}`);

  if (isInvalidName(options.sandboxNamePattern, parsed.data.name)) {
    return textError(`invalid sandbox name: ${JSON.stringify(parsed.data.name)}`);
  }

  try {
    const response = (await client.deleteSandbox({ name: parsed.data.name })) as { deleted?: boolean };
    return textResult(`deleted: ${response.deleted === true}`);
  } catch (err) {
    return textError(formatGrpcError("destroy-failed", err));
  }
}
