import {
  getTracer, redactArgs,
  type AuditStore, type ToolCallContext, type ToolCallResult, type ToolProvider,
} from "@mcp-conductor/core";
import { SpanStatusCode } from "@opentelemetry/api";

export interface AuditWrapperOptions {
  store: AuditStore;
  redactExtraKeys?: string[];
  maxArgBytes?: number;
}

export function auditedProvider(inner: ToolProvider, options: AuditWrapperOptions): ToolProvider {
  const tracer = getTracer("mcp-conductor.gateway");
  return {
    name: inner.name,
    connect: () => inner.connect(),
    close: () => inner.close(),
    listTools: () => inner.listTools(),
    async callTool(name, args, ctx: ToolCallContext): Promise<ToolCallResult> {
      const started = Date.now();
      const redactedArgs = redactArgs(args, { extraKeys: options.redactExtraKeys, maxBytes: options.maxArgBytes });
      const span = tracer.startSpan(`tool.call ${inner.name}__${name}`, {
        attributes: {
          "tool.provider": inner.name,
          "tool.name": name,
          "user.name": ctx.user,
          "request.id": ctx.requestId ?? "",
        },
      });
      try {
        const res = await inner.callTool(name, args, ctx);
        const status: "success" | "error" = res.isError ? "error" : "success";
        await options.store.insertCall({
          ts: new Date().toISOString(),
          user: ctx.user,
          provider: inner.name,
          tool: name,
          args: redactedArgs,
          status,
          durationMs: Date.now() - started,
          error: res.isError ? JSON.stringify(res.content) : null,
          requestId: ctx.requestId ?? null,
        });
        if (res.isError) span.setStatus({ code: SpanStatusCode.ERROR });
        return res;
      } catch (err) {
        const message = (err as Error).message;
        await options.store.insertCall({
          ts: new Date().toISOString(),
          user: ctx.user,
          provider: inner.name,
          tool: name,
          args: redactedArgs,
          status: "error",
          durationMs: Date.now() - started,
          error: message,
          requestId: ctx.requestId ?? null,
        });
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        throw err;
      } finally {
        span.end();
      }
    },
  };
}
