import type { ToolProvider } from "@conductor/core";
import { McpProvider } from "@conductor/provider-mcp";
import type { ProviderEntry } from "./conductor-config.js";
import { filteredProvider } from "./filtered-provider.js";

export function createProvider(entry: ProviderEntry): ToolProvider {
  if (entry.type === "mcp") {
    const raw = new McpProvider({
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
    return filteredProvider(raw, { allowTools: entry.allow_tools, excludeTools: entry.exclude_tools });
  }
  // Exhaustiveness guard — Zod ensures only known `type`s reach here.
  throw new Error(`unknown provider type: ${(entry as { type: string }).type}`);
}
