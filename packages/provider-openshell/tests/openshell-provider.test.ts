import { describe, test, expect, vi, beforeEach } from "vitest";
import { ProviderError } from "@mcp-conductor/core";
import type { ToolCallContext } from "@mcp-conductor/core";
import { OpenShellProvider } from "../src/openshell-provider.js";
import type { OpenShellClient } from "../src/openshell-client.js";

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

let client: ReturnType<typeof makeFakeClient>;
let provider: OpenShellProvider;

beforeEach(() => {
  client = makeFakeClient();
  provider = new OpenShellProvider(
    { endpoint: "127.0.0.1:8080", name: "shellboi" },
    { client: client as unknown as OpenShellClient },
  );
});

describe("OpenShellProvider", () => {
  test("name comes from options", () => {
    expect(provider.name).toBe("shellboi");
  });

  test("name defaults to 'openshell' when not provided", () => {
    const p = new OpenShellProvider(
      { endpoint: "127.0.0.1:8080" },
      { client: client as unknown as OpenShellClient },
    );
    expect(p.name).toBe("openshell");
  });

  test("connect() calls client.health() and resolves on ok", async () => {
    client.health.mockResolvedValue({ ok: true });
    await expect(provider.connect()).resolves.toBeUndefined();
    expect(client.health).toHaveBeenCalledTimes(1);
  });

  test("connect() throws ProviderError when health.ok is false", async () => {
    client.health.mockResolvedValue({ ok: false, message: "down" });
    await expect(provider.connect()).rejects.toBeInstanceOf(ProviderError);
  });

  test("connect() throws ProviderError when health rejects", async () => {
    client.health.mockRejectedValue(new Error("conn refused"));
    await expect(provider.connect()).rejects.toBeInstanceOf(ProviderError);
  });

  test("close() forwards to client.close()", async () => {
    client.close.mockResolvedValue(undefined);
    await provider.close();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test("listTools() returns all 8 specs", async () => {
    const tools = await provider.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "policy_set",
      "policy_status",
      "sandbox_create",
      "sandbox_destroy",
      "sandbox_exec",
      "sandbox_get",
      "sandbox_list",
      "sandbox_logs",
    ]);
    for (const t of tools) {
      expect(typeof t.description).toBe("string");
      expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });

  test("health() proxies client.health()", async () => {
    client.health.mockResolvedValue({ ok: true, message: "fine" });
    const result = await provider.health!();
    expect(result).toEqual({ ok: true, message: "fine" });
  });

  test("callTool routes sandbox_get to its handler", async () => {
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_1", name: "alpha" } });
    const result = await provider.callTool("sandbox_get", { name: "alpha" }, ctx);
    expect(result.isError).toBeFalsy();
    expect(client.getSandbox).toHaveBeenCalledWith({ name: "alpha" });
  });

  test("callTool routes sandbox_list to its handler", async () => {
    client.listSandboxes.mockResolvedValue({ sandboxes: [] });
    const result = await provider.callTool("sandbox_list", {}, ctx);
    expect(result.isError).toBeFalsy();
    expect(client.listSandboxes).toHaveBeenCalled();
  });

  test("callTool routes sandbox_destroy to its handler", async () => {
    client.deleteSandbox.mockResolvedValue({ deleted: true });
    const result = await provider.callTool("sandbox_destroy", { name: "alpha" }, ctx);
    expect(result.isError).toBeFalsy();
    expect(client.deleteSandbox).toHaveBeenCalledWith({ name: "alpha" });
  });

  test("callTool routes sandbox_exec to its handler with signal", async () => {
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_1" } });
    client.execSandbox.mockResolvedValue({
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
    const ctrl = new AbortController();
    await provider.callTool(
      "sandbox_exec",
      { name: "alpha", command: ["echo", "hi"] },
      { user: "alice", signal: ctrl.signal },
    );
    expect(client.execSandbox).toHaveBeenCalledTimes(1);
    expect(client.execSandbox.mock.calls[0]![1]).toBe(ctrl.signal);
  });

  test("callTool routes sandbox_logs to its handler", async () => {
    client.getSandbox.mockResolvedValue({ sandbox: { id: "sbx_1" } });
    client.getSandboxLogs.mockResolvedValue({ logs: [] });
    const result = await provider.callTool("sandbox_logs", { name: "alpha" }, ctx);
    expect(result.isError).toBeFalsy();
    expect(client.getSandboxLogs).toHaveBeenCalled();
  });

  test("callTool routes policy_set to its handler", async () => {
    client.updateConfig.mockResolvedValue({ version: 1 });
    const result = await provider.callTool(
      "policy_set",
      { name: "alpha", policy: {} },
      ctx,
    );
    expect(result.isError).toBeFalsy();
    expect(client.updateConfig).toHaveBeenCalled();
  });

  test("callTool routes policy_status to its handler", async () => {
    client.getSandboxPolicyStatus.mockResolvedValue({ active_version: 1 });
    const result = await provider.callTool("policy_status", { name: "alpha" }, ctx);
    expect(result.isError).toBeFalsy();
    expect(client.getSandboxPolicyStatus).toHaveBeenCalled();
  });

  test("callTool returns error result for unknown tool", async () => {
    const result = await provider.callTool("does_not_exist", {}, ctx);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/unknown tool/i);
    expect(text).toMatch(/does_not_exist/);
  });
});
