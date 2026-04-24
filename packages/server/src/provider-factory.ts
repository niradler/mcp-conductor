import type { ToolProvider } from "@mcp-conductor/core";
import { McpProvider } from "@mcp-conductor/provider-mcp";
import type { ProviderEntry } from "./conductor-config.js";

export function createProvider(entry: ProviderEntry): ToolProvider {
  if (entry.type === "mcp") {
    return new McpProvider({
      name: entry.name,
      transport: entry.transport,
      command: entry.command,
      args: entry.args ?? [],
      env: entry.env ?? {},
      initialListTimeoutMs: entry.initialListTimeoutMs ?? 15_000,
      callTimeoutMs: entry.callTimeoutMs ?? 60_000,
      reconnect: {
        maxAttempts: entry.reconnect?.maxAttempts ?? 10,
        initialDelayMs: entry.reconnect?.initialDelayMs ?? 1_000,
        maxDelayMs: entry.reconnect?.maxDelayMs ?? 30_000,
      },
    });
  }
  // Exhaustiveness guard — Zod ensures only known `type`s reach here.
  throw new Error(`unknown provider type: ${(entry as { type: string }).type}`);
}
