import { ProviderError } from "@mcp-conductor/core";
import type {
  ToolCallContext,
  ToolCallResult,
  ToolProvider,
  ToolSpec,
} from "@mcp-conductor/core";
import type { z } from "zod";
import { OpenShellProviderOptionsSchema, type OpenShellProviderOptions } from "./config.js";

export type OpenShellProviderOptionsInput = z.input<typeof OpenShellProviderOptionsSchema>;
import { OpenShellClient } from "./openshell-client.js";
import {
  POLICY_SET,
  POLICY_STATUS,
  SANDBOX_CREATE,
  SANDBOX_DESTROY,
  SANDBOX_EXEC,
  SANDBOX_GET,
  SANDBOX_LIST,
  SANDBOX_LOGS,
} from "./tools/specs.js";
import * as sandboxCreate from "./tools/sandbox-create.js";
import * as sandboxGet from "./tools/sandbox-get.js";
import * as sandboxList from "./tools/sandbox-list.js";
import * as sandboxDestroy from "./tools/sandbox-destroy.js";
import * as sandboxExec from "./tools/sandbox-exec.js";
import * as sandboxLogs from "./tools/sandbox-logs.js";
import * as policySet from "./tools/policy-set.js";
import * as policyStatus from "./tools/policy-status.js";
import { textError } from "./tools/util.js";

type ToolHandler = (
  client: OpenShellClient,
  options: OpenShellProviderOptions,
  args: unknown,
  ctx: ToolCallContext,
) => Promise<ToolCallResult>;

export interface OpenShellProviderDeps {
  client?: OpenShellClient;
}

export class OpenShellProvider implements ToolProvider {
  readonly name: string;
  private readonly client: OpenShellClient;
  private readonly options: OpenShellProviderOptions;
  private readonly handlers: Map<string, { spec: ToolSpec; handler: ToolHandler }>;

  constructor(options: OpenShellProviderOptionsInput, deps: OpenShellProviderDeps = {}) {
    this.options = OpenShellProviderOptionsSchema.parse(options);
    this.name = this.options.name;
    this.client =
      deps.client ??
      new OpenShellClient({
        endpoint: this.options.endpoint,
        tls: this.options.tls,
        timeouts: this.options.timeouts,
      });
    this.handlers = new Map<string, { spec: ToolSpec; handler: ToolHandler }>([
      [SANDBOX_CREATE.name, { spec: SANDBOX_CREATE, handler: sandboxCreate.handler }],
      [SANDBOX_GET.name, { spec: SANDBOX_GET, handler: sandboxGet.handler }],
      [SANDBOX_LIST.name, { spec: SANDBOX_LIST, handler: sandboxList.handler }],
      [SANDBOX_DESTROY.name, { spec: SANDBOX_DESTROY, handler: sandboxDestroy.handler }],
      [SANDBOX_EXEC.name, { spec: SANDBOX_EXEC, handler: sandboxExec.handler }],
      [SANDBOX_LOGS.name, { spec: SANDBOX_LOGS, handler: sandboxLogs.handler }],
      [POLICY_SET.name, { spec: POLICY_SET, handler: policySet.handler }],
      [POLICY_STATUS.name, { spec: POLICY_STATUS, handler: policyStatus.handler }],
    ]);
  }

  async connect(): Promise<void> {
    let result: { ok: boolean; message?: string };
    try {
      result = (await this.client.health()) as { ok: boolean; message?: string };
    } catch (err) {
      throw new ProviderError(
        `openshell health check failed: ${(err as Error).message}`,
        this.name,
      );
    }
    if (!result.ok) {
      throw new ProviderError(
        `openshell unhealthy${result.message ? `: ${result.message}` : ""}`,
        this.name,
      );
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async listTools(): Promise<ToolSpec[]> {
    return Array.from(this.handlers.values(), (entry) => entry.spec);
  }

  async callTool(
    name: string,
    args: unknown,
    ctx: ToolCallContext,
  ): Promise<ToolCallResult> {
    const entry = this.handlers.get(name);
    if (!entry) return textError(`unknown tool: ${name}`);
    return entry.handler(this.client, this.options, args, ctx);
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    return (await this.client.health()) as { ok: boolean; message?: string };
  }
}
