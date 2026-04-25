import { describe, test, expect, vi, beforeEach } from "vitest";
import * as grpc from "@grpc/grpc-js";
import type { ToolCallContext } from "@mcp-conductor/core";
import { OpenShellProviderOptionsSchema, type OpenShellProviderOptions } from "../src/config.js";
import * as sandboxExec from "../src/tools/sandbox-exec.js";
import type { ExecResult } from "../src/openshell-client.js";

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

function execResult(partial: Partial<ExecResult> = {}): ExecResult {
  return {
    stdout: Buffer.from(""),
    stderr: Buffer.from(""),
    exitCode: 0,
    durationMs: 5,
    timedOut: false,
    ...partial,
  };
}

const ctx: ToolCallContext = { user: "alice" };

let options: OpenShellProviderOptions;
beforeEach(() => {
  options = OpenShellProviderOptionsSchema.parse({ endpoint: "127.0.0.1:8080" });
});

describe("sandbox_exec", () => {
  test("resolves name -> id, then calls execSandbox with sandbox_id and command", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_42", name: "alpha" } });
    client.execSandbox.mockResolvedValue(execResult({ stdout: Buffer.from("hello\n") }));

    const result = await sandboxExec.handler(
      client as never,
      options,
      { name: "alpha", command: ["echo", "hello"] },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(client.getSandbox).toHaveBeenCalledWith({ name: "alpha" });
    expect(client.execSandbox).toHaveBeenCalledTimes(1);
    const [execReq] = client.execSandbox.mock.calls[0]!;
    expect(execReq).toMatchObject({
      sandbox_id: "sbx_42",
      command: ["echo", "hello"],
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/exit: 0/);
    expect(text).toMatch(/hello/);
  });

  test("flags non-zero exit code with isError but still includes stdout/stderr", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_1" } });
    client.execSandbox.mockResolvedValue(execResult({
      stdout: Buffer.from("partial\n"),
      stderr: Buffer.from("err: bad\n"),
      exitCode: 2,
    }));

    const result = await sandboxExec.handler(
      client as never,
      options,
      { name: "alpha", command: ["false"] },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/exit: 2/);
    expect(text).toMatch(/partial/);
    expect(text).toMatch(/err: bad/);
  });

  test("flags timeout with [timeout] prefix and isError, including any partial output", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_1" } });
    client.execSandbox.mockResolvedValue(execResult({
      stdout: Buffer.from("started"),
      stderr: Buffer.from(""),
      exitCode: null,
      timedOut: true,
    }));

    const result = await sandboxExec.handler(
      client as never,
      options,
      { name: "alpha", command: ["sleep", "9999"] },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/\[timeout\]/);
    expect(text).toMatch(/started/);
  });

  test("rejects invalid sandbox name without making RPCs", async () => {
    const client = makeFakeClient();
    const result = await sandboxExec.handler(
      client as never,
      options,
      { name: "has spaces", command: ["echo", "x"] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(client.getSandbox).not.toHaveBeenCalled();
    expect(client.execSandbox).not.toHaveBeenCalled();
  });

  test("rejects empty command (minItems: 1) without making RPCs", async () => {
    const client = makeFakeClient();
    const result = await sandboxExec.handler(
      client as never,
      options,
      { name: "alpha", command: [] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(client.getSandbox).not.toHaveBeenCalled();
  });

  test("forwards ctx.signal as the second argument to client.execSandbox", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_1" } });
    client.execSandbox.mockResolvedValue(execResult());
    const ctrl = new AbortController();

    await sandboxExec.handler(
      client as never,
      options,
      { name: "alpha", command: ["echo", "x"] },
      { user: "alice", signal: ctrl.signal },
    );

    expect(client.execSandbox).toHaveBeenCalledTimes(1);
    expect(client.execSandbox.mock.calls[0]![1]).toBe(ctrl.signal);
  });

  test("surfaces NOT_FOUND from getSandbox as a helpful error message", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockRejectedValue(grpcError(grpc.status.NOT_FOUND, "sandbox not found"));
    const result = await sandboxExec.handler(
      client as never,
      options,
      { name: "alpha", command: ["echo", "x"] },
      ctx,
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/alpha/);
    expect(text).toMatch(/not found/i);
    expect(client.execSandbox).not.toHaveBeenCalled();
  });

  test("surfaces non-NOT_FOUND gRPC error from getSandbox with code prefix", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockRejectedValue(grpcError(grpc.status.INTERNAL, "boom"));
    const result = await sandboxExec.handler(
      client as never,
      options,
      { name: "alpha", command: ["echo", "x"] },
      ctx,
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/INTERNAL/);
    expect(text).toMatch(/boom/);
  });

  test("forwards optional fields (workdir, environment, timeoutSeconds, stdin)", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_1" } });
    client.execSandbox.mockResolvedValue(execResult());

    await sandboxExec.handler(
      client as never,
      options,
      {
        name: "alpha",
        command: ["sh", "-c", "cat"],
        workdir: "/work",
        environment: { FOO: "bar" },
        timeoutSeconds: 30,
        stdin: "hello",
      },
      ctx,
    );

    const [execReq] = client.execSandbox.mock.calls[0]!;
    expect(execReq).toMatchObject({
      sandbox_id: "sbx_1",
      command: ["sh", "-c", "cat"],
      workdir: "/work",
      environment: { FOO: "bar" },
      timeout_seconds: 30,
    });
    expect(Buffer.isBuffer((execReq as { stdin: unknown }).stdin)).toBe(true);
    expect(((execReq as { stdin: Buffer }).stdin).toString("utf8")).toBe("hello");
  });
});
