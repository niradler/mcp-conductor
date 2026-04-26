import { z } from "zod";

/** A tool advertised by a provider. Matches MCP tool shape because that's our external protocol. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (draft-07 compatible) for the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCallContext {
  /** Identity of the caller as resolved by gateway auth. Passed through so providers can scope work. */
  user: string;
  /** Correlation id threaded from the HTTP request. */
  requestId?: string;
  /** Abort signal — providers should honor it for long-running calls. */
  signal?: AbortSignal;
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "json"; json: unknown }
  | { type: "image"; data: string; mimeType: string; [k: string]: unknown }
  | { type: "audio"; data: string; mimeType: string; [k: string]: unknown }
  | { type: "resource_link"; name: string; uri: string; [k: string]: unknown }
  | { type: "resource"; resource: { uri: string; text: string; [k: string]: unknown } | { uri: string; blob: string; [k: string]: unknown }; [k: string]: unknown };

export interface ToolCallResult {
  isError?: boolean;
  content: ToolContent[];
}

/**
 * A source of tools. Implementations:
 *  - `@mcp-conductor/provider-mcp`    — stdio/SSE MCP upstream
 *  - future: OpenAPI, GraphQL, HTTP, sandbox, ...
 */
export interface ToolProvider {
  readonly name: string;
  /** Human-readable description advertised by the upstream (e.g. MCP `serverInfo.description`). Populated after `connect()`. */
  readonly description?: string;
  /** Optional usage guidance from the upstream (e.g. MCP `initialize.instructions`). Populated after `connect()`. */
  readonly instructions?: string;
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<ToolSpec[]>;
  callTool(name: string, args: unknown, ctx: ToolCallContext): Promise<ToolCallResult>;
  health?(): Promise<{ ok: boolean; message?: string }>;
}

export const ToolSpecSchema: z.ZodType<ToolSpec> = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
});
