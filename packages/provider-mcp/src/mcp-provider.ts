import type {
  ToolCallContext,
  ToolCallResult,
  ToolProvider,
  ToolSpec,
} from "@conductor/core";
import { McpProviderOptionsSchema, type McpProviderOptions } from "./config.js";
import { UpstreamClient } from "./upstream-client.js";

export class McpProvider implements ToolProvider {
  readonly name: string;
  private readonly client: UpstreamClient;

  constructor(options: unknown) {
    const parsed: McpProviderOptions = McpProviderOptionsSchema.parse(options);
    this.name = parsed.name;
    this.client = new UpstreamClient(parsed);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async listTools(): Promise<ToolSpec[]> {
    return this.client.list();
  }

  async callTool(name: string, args: unknown, ctx: ToolCallContext): Promise<ToolCallResult> {
    return this.client.call(name, args, ctx.signal);
  }
}
