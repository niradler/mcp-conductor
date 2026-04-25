import { describe, test, expect, vi, beforeEach } from "vitest";
import * as grpc from "@grpc/grpc-js";
import type { ToolCallContext } from "@conductor/core";
import { OpenShellProviderOptionsSchema, type OpenShellProviderOptions } from "../src/config.js";
import * as sandboxCreate from "../src/tools/sandbox-create.js";
import * as sandboxGet from "../src/tools/sandbox-get.js";
import * as sandboxList from "../src/tools/sandbox-list.js";
import * as sandboxDestroy from "../src/tools/sandbox-destroy.js";
import {
  SANDBOX_CREATE,
  SANDBOX_GET,
  SANDBOX_LIST,
  SANDBOX_DESTROY,
  SANDBOX_EXEC,
  SANDBOX_LOGS,
  POLICY_SET,
  POLICY_STATUS,
} from "../src/tools/specs.js";

// Tests use a tiny ad-hoc fake instead of the real OpenShellClient — we want to assert how
// each handler talks to the client, not how the client talks to gRPC.
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

const ctx: ToolCallContext = { user: "alice" };

let options: OpenShellProviderOptions;
beforeEach(() => {
  options = OpenShellProviderOptionsSchema.parse({ endpoint: "127.0.0.1:8080" });
});

const validSpec = {
  template: { image: "ubuntu:24.04" },
  policy: {},
};

function grpcError(code: number, message: string): grpc.ServiceError {
  return Object.assign(new Error(message), {
    code,
    details: message,
    metadata: new grpc.Metadata(),
  }) as grpc.ServiceError;
}

describe("tool specs", () => {
  test("all 8 specs are exported with the expected names", () => {
    expect(SANDBOX_CREATE.name).toBe("sandbox_create");
    expect(SANDBOX_GET.name).toBe("sandbox_get");
    expect(SANDBOX_LIST.name).toBe("sandbox_list");
    expect(SANDBOX_DESTROY.name).toBe("sandbox_destroy");
    expect(SANDBOX_EXEC.name).toBe("sandbox_exec");
    expect(SANDBOX_LOGS.name).toBe("sandbox_logs");
    expect(POLICY_SET.name).toBe("policy_set");
    expect(POLICY_STATUS.name).toBe("policy_status");
  });

  test("every spec has additionalProperties:false", () => {
    for (const spec of [SANDBOX_CREATE, SANDBOX_GET, SANDBOX_LIST, SANDBOX_DESTROY, SANDBOX_EXEC, SANDBOX_LOGS, POLICY_SET, POLICY_STATUS]) {
      expect(spec.inputSchema.additionalProperties).toBe(false);
      expect(spec.inputSchema.type).toBe("object");
      expect(spec.description).toMatch(/.+/);
    }
  });
});

describe("sandbox_create", () => {
  test("forwards { name, spec } to client.createSandbox and returns the response as JSON", async () => {
    const client = makeFakeClient();
    client.createSandbox.mockResolvedValue({ sandbox: { id: "sbx_1", name: "alpha" } });

    const result = await sandboxCreate.handler(client as never, options, { name: "alpha", spec: validSpec }, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "json", json: { sandbox: { id: "sbx_1", name: "alpha" } } }]);
    expect(client.createSandbox).toHaveBeenCalledTimes(1);
    const arg = client.createSandbox.mock.calls[0]![0];
    expect(arg).toMatchObject({ name: "alpha" });
    expect(arg).toHaveProperty("spec");
  });

  test("works without a name (server-generated)", async () => {
    const client = makeFakeClient();
    client.createSandbox.mockResolvedValue({ sandbox: { id: "sbx_2" } });
    const result = await sandboxCreate.handler(client as never, options, { spec: validSpec }, ctx);
    expect(result.isError).toBeFalsy();
    expect(client.createSandbox).toHaveBeenCalledTimes(1);
  });

  test("rejects invalid sandbox name without hitting the client", async () => {
    const client = makeFakeClient();
    const result = await sandboxCreate.handler(client as never, options, { name: "has spaces", spec: validSpec }, ctx);
    expect(result.isError).toBe(true);
    expect(client.createSandbox).not.toHaveBeenCalled();
  });

  test("rejects invalid args (missing spec) without hitting the client", async () => {
    const client = makeFakeClient();
    const result = await sandboxCreate.handler(client as never, options, { name: "alpha" }, ctx);
    expect(result.isError).toBe(true);
    expect(client.createSandbox).not.toHaveBeenCalled();
  });

  test("surfaces gRPC error as isError with code-prefixed text", async () => {
    const client = makeFakeClient();
    client.createSandbox.mockRejectedValue(grpcError(grpc.status.INVALID_ARGUMENT, "bad spec"));
    const result = await sandboxCreate.handler(client as never, options, { name: "alpha", spec: validSpec }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/INVALID_ARGUMENT/);
    expect(text).toMatch(/bad spec/);
  });
});

describe("sandbox_get", () => {
  test("forwards { name } and returns sandbox as JSON", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_1", name: "alpha" } });
    const result = await sandboxGet.handler(client as never, options, { name: "alpha" }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "json", json: { sandbox: { id: "sbx_1", name: "alpha" } } }]);
    expect(client.getSandbox).toHaveBeenCalledWith({ name: "alpha" });
  });

  test("rejects invalid name pattern without hitting client", async () => {
    const client = makeFakeClient();
    const result = await sandboxGet.handler(client as never, options, { name: "has/slash" }, ctx);
    expect(result.isError).toBe(true);
    expect(client.getSandbox).not.toHaveBeenCalled();
  });

  test("surfaces NOT_FOUND as isError", async () => {
    const client = makeFakeClient();
    client.getSandbox.mockRejectedValue(grpcError(grpc.status.NOT_FOUND, "no such sandbox"));
    const result = await sandboxGet.handler(client as never, options, { name: "alpha" }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/NOT_FOUND/);
  });
});

describe("sandbox_list", () => {
  test("with no args, sends limit=0 + offset=0 (server default)", async () => {
    const client = makeFakeClient();
    client.listSandboxes.mockResolvedValue({ sandboxes: [] });
    const result = await sandboxList.handler(client as never, options, {}, ctx);
    expect(result.isError).toBeFalsy();
    expect(client.listSandboxes).toHaveBeenCalledWith({ limit: 0, offset: 0 });
  });

  test("forwards explicit limit + offset", async () => {
    const client = makeFakeClient();
    client.listSandboxes.mockResolvedValue({ sandboxes: [{ id: "sbx_1" }] });
    const result = await sandboxList.handler(client as never, options, { limit: 50, offset: 10 }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "json", json: { sandboxes: [{ id: "sbx_1" }] } }]);
    expect(client.listSandboxes).toHaveBeenCalledWith({ limit: 50, offset: 10 });
  });

  test("clamps limit above 500 to 500", async () => {
    const client = makeFakeClient();
    client.listSandboxes.mockResolvedValue({ sandboxes: [] });
    await sandboxList.handler(client as never, options, { limit: 5000 }, ctx);
    expect(client.listSandboxes).toHaveBeenCalledWith({ limit: 500, offset: 0 });
  });

  test("rejects negative limit/offset", async () => {
    const client = makeFakeClient();
    const r1 = await sandboxList.handler(client as never, options, { limit: -1 }, ctx);
    const r2 = await sandboxList.handler(client as never, options, { offset: -1 }, ctx);
    expect(r1.isError).toBe(true);
    expect(r2.isError).toBe(true);
    expect(client.listSandboxes).not.toHaveBeenCalled();
  });
});

describe("sandbox_destroy", () => {
  test("forwards { name } and returns deleted flag as text", async () => {
    const client = makeFakeClient();
    client.deleteSandbox.mockResolvedValue({ deleted: true });
    const result = await sandboxDestroy.handler(client as never, options, { name: "alpha" }, ctx);
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/deleted: true/);
    expect(client.deleteSandbox).toHaveBeenCalledWith({ name: "alpha" });
  });

  test("reports deleted: false without isError", async () => {
    const client = makeFakeClient();
    client.deleteSandbox.mockResolvedValue({ deleted: false });
    const result = await sandboxDestroy.handler(client as never, options, { name: "alpha" }, ctx);
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/deleted: false/);
  });

  test("rejects invalid name pattern without hitting client", async () => {
    const client = makeFakeClient();
    const result = await sandboxDestroy.handler(client as never, options, { name: "" }, ctx);
    expect(result.isError).toBe(true);
    expect(client.deleteSandbox).not.toHaveBeenCalled();
  });

  test("surfaces gRPC error as isError", async () => {
    const client = makeFakeClient();
    client.deleteSandbox.mockRejectedValue(grpcError(grpc.status.PERMISSION_DENIED, "no"));
    const result = await sandboxDestroy.handler(client as never, options, { name: "alpha" }, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/PERMISSION_DENIED/);
  });
});
