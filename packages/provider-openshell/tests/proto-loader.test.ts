import { describe, test, expect } from "vitest";
import { loadProto } from "../src/proto-loader.js";

describe("loadProto", () => {
  test("returns an OpenShellService constructor function", () => {
    const { OpenShellService } = loadProto();
    expect(typeof OpenShellService).toBe("function");
    // grpc-js generated service client constructors expose a static `service` map keyed by RPC name.
    expect((OpenShellService as unknown as { service: Record<string, unknown> }).service).toBeTypeOf("object");
  });

  test("is cached — two calls return the same object", () => {
    expect(loadProto()).toBe(loadProto());
  });

  test("service definition includes all RPCs the provider calls", () => {
    const { OpenShellService } = loadProto();
    const def = (OpenShellService as unknown as { service: Record<string, unknown> }).service;
    const rpcs = Object.keys(def);
    expect(rpcs).toEqual(
      expect.arrayContaining([
        "Health",
        "CreateSandbox",
        "GetSandbox",
        "ListSandboxes",
        "DeleteSandbox",
        "ExecSandbox",
        "GetSandboxLogs",
        "UpdateConfig",
        "GetSandboxPolicyStatus",
      ]),
    );
  });

  test("ExecSandbox is flagged as a server-streaming RPC", () => {
    const { OpenShellService } = loadProto();
    const def = (OpenShellService as unknown as { service: Record<string, { responseStream: boolean; requestStream: boolean }> }).service;
    expect(def.ExecSandbox?.responseStream).toBe(true);
    expect(def.ExecSandbox?.requestStream).toBe(false);
  });

  test("Health is flagged as a unary RPC", () => {
    const { OpenShellService } = loadProto();
    const def = (OpenShellService as unknown as { service: Record<string, { responseStream: boolean; requestStream: boolean }> }).service;
    expect(def.Health?.responseStream).toBe(false);
    expect(def.Health?.requestStream).toBe(false);
  });
});
