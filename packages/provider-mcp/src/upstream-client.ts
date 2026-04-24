import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ProviderError, createLogger } from "@mcp-conductor/core";
import type { ToolCallResult, ToolContent, ToolSpec } from "@mcp-conductor/core";
import type { McpProviderOptions } from "./config.js";

export class UpstreamClient {
  private readonly log = createLogger("provider-mcp");
  private readonly opts: McpProviderOptions;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private reconnecting: Promise<void> | null = null;
  private closed = false;

  constructor(opts: McpProviderOptions) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new ProviderError("client closed", this.opts.name);
    if (this.client) return;
    this.transport = new StdioClientTransport({
      command: this.opts.command,
      args: this.opts.args,
      env: { ...process.env, ...this.opts.env } as Record<string, string>,
    });
    this.client = new Client(
      { name: `mcp-conductor/${this.opts.name}`, version: "0.2.0" },
      { capabilities: {} },
    );
    await this.withTimeout(
      this.client.connect(this.transport),
      this.opts.initialListTimeoutMs,
      "connect",
    );
    this.transport.onclose = () => {
      this.scheduleReconnect();
    };
  }

  private async withTimeout<T>(
    p: Promise<T>,
    ms: number,
    label: string,
    signal?: AbortSignal,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ProviderError(`${label} timeout after ${ms}ms`, this.opts.name)),
        ms,
      );
    });
    const aborted = signal
      ? new Promise<never>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new ProviderError(`${label} aborted`, this.opts.name)),
            { once: true },
          );
        })
      : new Promise<never>(() => {});
    try {
      return await Promise.race([p, timeout, aborted]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = (async () => {
      const { maxAttempts, initialDelayMs, maxDelayMs } = this.opts.reconnect;
      let delay = initialDelayMs;
      for (let attempt = 1; attempt <= maxAttempts && !this.closed; attempt++) {
        await new Promise((r) => setTimeout(r, delay));
        try {
          this.client = null;
          this.transport = null;
          await this.connect();
          this.log.info("reconnected", { provider: this.opts.name, attempt });
          this.reconnecting = null;
          return;
        } catch (err) {
          this.log.warn("reconnect failed", { provider: this.opts.name, attempt, err });
          delay = Math.min(delay * 2, maxDelayMs);
        }
      }
      this.log.error("reconnect gave up", { provider: this.opts.name });
      this.reconnecting = null;
    })();
  }

  async list(): Promise<ToolSpec[]> {
    if (!this.client) throw new ProviderError("not connected", this.opts.name);
    const res = await this.client.listTools();
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object" },
    }));
  }

  async call(name: string, args: unknown, signal?: AbortSignal): Promise<ToolCallResult> {
    if (this.reconnecting) await this.reconnecting;
    if (!this.client) throw new ProviderError("not connected", this.opts.name);
    const call = this.client.callTool({ name, arguments: args as Record<string, unknown> });
    const res = await this.withTimeout(call, this.opts.callTimeoutMs, `call ${name}`, signal);
    return {
      isError: res.isError as boolean | undefined,
      content: ((res.content as ToolContent[] | undefined) ?? []),
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.client?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.transport?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
    this.transport = null;
  }
}
