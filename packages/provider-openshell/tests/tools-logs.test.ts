import { describe, test, expect, vi, beforeEach } from "vitest";
import * as grpc from "@grpc/grpc-js";
import type { ToolCallContext } from "@mcp-conductor/core";
import { OpenShellProviderOptionsSchema, type OpenShellProviderOptions } from "../src/config.js";
import * as sandboxLogs from "../src/tools/sandbox-logs.js";

function makeFakeClient() {
  return {
    createSandbox: vi.fn(),
    getSandbox: vi.fn(),
    listSandboxes: vi.fn(),
    deleteSandbox: vi.fn(),
    getSandboxLogs: vi.fn(),
    updateConfig: vi.fn(),
    getSandboxPolicyStatus: vi.fn(),
    execSandbox: vi.fn(),
    health: vi.fn(),
    close: vi.fn(),
  };
}

function grpcError(code: number, message: string): grpc.ServiceError {
  return Object.assign(new Error(message), {
    code,
    details: message,
    metadata: new grpc.Metadata(),
  }) as grpc.ServiceError;
}

const ctx: ToolCallContext = { user: "alice" };

let options: OpenShellProviderOptions;
beforeEach(() => {
  options = OpenShellProviderOptionsSchema.parse({ endpoint: "127.0.0.1:8080" });
});

describe("sandbox_logs", () => {
  test("resolves name -> id, sends sandbox_id with default lines and since_ms=0", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_42" } });
    client.getSandboxLogs.mockResolvedValue({ logs: [{ ts_ms: 1, message: "hi" }], buffer_total: 1 });

    const result = await sandboxLogs.handler(client as never, options, { name: "alpha" }, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      { type: "json", json: { logs: [{ ts_ms: 1, message: "hi" }], buffer_total: 1 } },
    ]);
    expect(client.getSandbox).toHaveBeenCalledWith({ name: "alpha" });
    expect(client.getSandboxLogs).toHaveBeenCalledWith({ sandbox_id: "sbx_42", lines: 500, since_ms: 0 });
  });

  test("forwards explicit lines and sinceMs", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_42" } });
    client.getSandboxLogs.mockResolvedValue({ logs: [], buffer_total: 0 });

    await sandboxLogs.handler(client as never, options, { name: "alpha", lines: 100, sinceMs: 12345 }, ctx);

    expect(client.getSandboxLogs).toHaveBeenCalledWith({
      sandbox_id: "sbx_42",
      lines: 100,
      since_ms: 12345,
    });
  });

  test("clamps lines above 10000 to 10000", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_42" } });
    client.getSandboxLogs.mockResolvedValue({ logs: [] });
    await sandboxLogs.handler(client as never, options, { name: "alpha", lines: 99_999 }, ctx);
    expect(client.getSandboxLogs.mock.calls[0]![0]).toMatchObject({ lines: 10_000 });
  });

  test("rejects invalid name pattern without RPCs", async () => {
    const client = makeFakeClient();
    const result = await sandboxLogs.handler(client as never, options, { name: "has spaces" }, ctx);
    expect(result.isError).toBe(true);
    expect(client.getSandbox).not.toHaveBeenCalled();
  });

  test("surfaces NOT_FOUND from getSandbox as a helpful error", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockRejectedValue(grpcError(grpc.status.NOT_FOUND, "no"));
    const result = await sandboxLogs.handler(client as never, options, { name: "alpha" }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/alpha/);
    expect(client.getSandboxLogs).not.toHaveBeenCalled();
  });

  test("surfaces gRPC error from getSandboxLogs with code prefix", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_1" } });
    client.getSandboxLogs.mockRejectedValue(grpcError(grpc.status.INTERNAL, "boom"));
    const result = await sandboxLogs.handler(client as never, options, { name: "alpha" }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/INTERNAL/);
    expect(text).toMatch(/boom/);
  });

  test("rejects non-positive lines", async () => {
    const client = makeFakeClient();
    const result = await sandboxLogs.handler(client as never, options, { name: "alpha", lines: 0 }, ctx);
    expect(result.isError).toBe(true);
    expect(client.getSandbox).not.toHaveBeenCalled();
  });
});
