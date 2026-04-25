import { describe, test, expect, vi, beforeEach } from "vitest";
import * as grpc from "@grpc/grpc-js";
import type { ToolCallContext } from "@mcp-conductor/core";
import { OpenShellProviderOptionsSchema, type OpenShellProviderOptions } from "../src/config.js";
import * as policySet from "../src/tools/policy-set.js";
import * as policyStatus from "../src/tools/policy-status.js";

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

const minimalPolicy = {
  version: 2,
  network_policies: {
    egress: {
      name: "egress",
      endpoints: [{ host: "example.com", ports: [443] }],
    },
  },
};

describe("policy_set", () => {
  test("calls updateConfig with name + parsed policy + global:false", async () => {
    const client = makeFakeClient();
    client.updateConfig.mockResolvedValue({ version: 2, policy_hash: "abc" });

    const result = await policySet.handler(
      client as never,
      options,
      { name: "alpha", policy: minimalPolicy },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(client.updateConfig).toHaveBeenCalledTimes(1);
    const [req] = client.updateConfig.mock.calls[0]!;
    expect(req).toMatchObject({
      name: "alpha",
      global: false,
    });
    expect((req as { policy: { version: number } }).policy.version).toBe(2);
    expect(result.content).toEqual([
      { type: "json", json: { version: 2, policy_hash: "abc" } },
    ]);
  });

  test("populates policy defaults when omitted", async () => {
    const client = makeFakeClient();
    client.updateConfig.mockResolvedValue({ version: 1 });

    await policySet.handler(
      client as never,
      options,
      { name: "alpha", policy: {} },
      ctx,
    );

    const [req] = client.updateConfig.mock.calls[0]!;
    const policy = (req as { policy: Record<string, unknown> }).policy;
    expect(policy).toMatchObject({
      version: 1,
      filesystem: { include_workdir: true },
      network_policies: {},
    });
  });

  test("rejects invalid policy shape without RPC", async () => {
    const client = makeFakeClient();
    const result = await policySet.handler(
      client as never,
      options,
      { name: "alpha", policy: { version: -1 } },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(client.updateConfig).not.toHaveBeenCalled();
  });

  test("rejects invalid sandbox name without RPC", async () => {
    const client = makeFakeClient();
    const result = await policySet.handler(
      client as never,
      options,
      { name: "has spaces", policy: minimalPolicy },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(client.updateConfig).not.toHaveBeenCalled();
  });

  test("surfaces gRPC error from updateConfig with code prefix", async () => {
    const client = makeFakeClient();
    client.updateConfig.mockRejectedValue(grpcError(grpc.status.FAILED_PRECONDITION, "rejected"));
    const result = await policySet.handler(
      client as never,
      options,
      { name: "alpha", policy: minimalPolicy },
      ctx,
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/FAILED_PRECONDITION/);
    expect(text).toMatch(/rejected/);
  });

  test("rejects extra top-level args", async () => {
    const client = makeFakeClient();
    const result = await policySet.handler(
      client as never,
      options,
      { name: "alpha", policy: minimalPolicy, extra: 1 },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(client.updateConfig).not.toHaveBeenCalled();
  });
});

describe("policy_status", () => {
  test("calls getSandboxPolicyStatus with name, version=0 default, global:false", async () => {
    const client = makeFakeClient();
    client.getSandboxPolicyStatus.mockResolvedValue({
      revision: { version: 3 },
      active_version: 3,
    });

    const result = await policyStatus.handler(
      client as never,
      options,
      { name: "alpha" },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(client.getSandboxPolicyStatus).toHaveBeenCalledWith({
      name: "alpha",
      version: 0,
      global: false,
    });
    expect(result.content).toEqual([
      { type: "json", json: { revision: { version: 3 }, active_version: 3 } },
    ]);
  });

  test("forwards explicit version", async () => {
    const client = makeFakeClient();
    client.getSandboxPolicyStatus.mockResolvedValue({});
    await policyStatus.handler(
      client as never,
      options,
      { name: "alpha", version: 5 },
      ctx,
    );
    expect(client.getSandboxPolicyStatus).toHaveBeenCalledWith({
      name: "alpha",
      version: 5,
      global: false,
    });
  });

  test("rejects invalid sandbox name without RPC", async () => {
    const client = makeFakeClient();
    const result = await policyStatus.handler(
      client as never,
      options,
      { name: "has spaces" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(client.getSandboxPolicyStatus).not.toHaveBeenCalled();
  });

  test("rejects negative version without RPC", async () => {
    const client = makeFakeClient();
    const result = await policyStatus.handler(
      client as never,
      options,
      { name: "alpha", version: -1 },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(client.getSandboxPolicyStatus).not.toHaveBeenCalled();
  });

  test("surfaces gRPC error with code prefix", async () => {
    const client = makeFakeClient();
    client.getSandboxPolicyStatus.mockRejectedValue(grpcError(grpc.status.NOT_FOUND, "missing"));
    const result = await policyStatus.handler(
      client as never,
      options,
      { name: "alpha" },
      ctx,
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/NOT_FOUND/);
    expect(text).toMatch(/missing/);
  });
});
