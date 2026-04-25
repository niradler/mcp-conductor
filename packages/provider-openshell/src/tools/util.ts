import * as grpc from "@grpc/grpc-js";
import type { ToolCallResult } from "@conductor/core";

export function textResult(text: string): ToolCallResult {
  return { content: [{ type: "text", text }] };
}

export function textError(text: string): ToolCallResult {
  return { isError: true, content: [{ type: "text", text }] };
}

export function jsonResult(json: unknown): ToolCallResult {
  return { content: [{ type: "json", json }] };
}

/** Format a thrown gRPC ServiceError as a "[prefix:CODE_NAME] message" string. */
export function formatGrpcError(prefix: string, err: unknown): string {
  const e = err as { code?: number; message?: string };
  const codeName =
    typeof e.code === "number" ? grpc.status[e.code] ?? String(e.code) : "UNKNOWN";
  return `[${prefix}:${codeName}] ${e.message ?? String(err)}`;
}

export function isInvalidName(pattern: string, name: string): boolean {
  return !new RegExp(pattern).test(name);
}
