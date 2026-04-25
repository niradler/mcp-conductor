import * as grpc from "@grpc/grpc-js";
import { z } from "zod";
import type { ToolCallContext, ToolCallResult } from "@mcp-conductor/core";
import type { OpenShellClient } from "../openshell-client.js";
import type { OpenShellProviderOptions } from "../config.js";
import { isInvalidName, textError, formatGrpcError } from "./util.js";

const ArgsSchema = z
  .object({
    name: z.string(),
    command: z.array(z.string()).min(1),
    workdir: z.string().optional(),
    environment: z.record(z.string()).optional(),
    timeoutSeconds: z.number().int().nonnegative().optional(),
    stdin: z.string().optional(),
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
  ctx: ToolCallContext,
): Promise<ToolCallResult> {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) return textError(`invalid args: ${parsed.error.message}`);

  const { name, command, workdir, environment, timeoutSeconds, stdin } = parsed.data;
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
    return textError(formatGrpcError("exec-lookup-failed", err));
  }

  const sandboxId = lookup.sandbox?.id;
  if (!sandboxId) {
    return textError(`sandbox not found: ${name}`);
  }

  const execReq = {
    sandbox_id: sandboxId,
    command,
    workdir: workdir ?? "",
    environment: environment ?? {},
    timeout_seconds: timeoutSeconds ?? 0,
    stdin: stdin !== undefined ? Buffer.from(stdin, "utf8") : Buffer.alloc(0),
    tty: false,
  };

  let result: Awaited<ReturnType<OpenShellClient["execSandbox"]>>;
  try {
    result = await client.execSandbox(execReq, ctx.signal);
  } catch (err) {
    return textError(formatGrpcError("exec-failed", err));
  }

  const stdoutText = result.stdout.toString("utf8");
  const stderrText = result.stderr.toString("utf8");

  if (result.timedOut) {
    return textError(
      `[timeout] exec exceeded deadline\n\nstdout:\n${stdoutText}\n\nstderr:\n${stderrText}`,
    );
  }

  const isError = result.exitCode !== 0;
  const text =
    `exit: ${result.exitCode ?? "null"}\n\n` +
    `stdout:\n${stdoutText}\n\n` +
    `stderr:\n${stderrText}\n\n` +
    `duration: ${result.durationMs}ms`;
  return { isError, content: [{ type: "text", text }] };
}
