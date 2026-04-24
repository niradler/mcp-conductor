import { describe, test, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import * as grpc from "@grpc/grpc-js";

// A minimal fake of the generated grpc-js service client. Vitest hoists this so the mock below
// can reference it at module-evaluation time. Each constructed instance is captured on `last`
// so tests can grab the actual object OpenShellClient is talking to.
const { FakeService, getLastService } = vi.hoisted(() => {
  let last: unknown;
  class FakeService {
    endpoint!: string;
    creds!: unknown;
    Health!: ReturnType<typeof vi.fn>;
    CreateSandbox!: ReturnType<typeof vi.fn>;
    GetSandbox!: ReturnType<typeof vi.fn>;
    ListSandboxes!: ReturnType<typeof vi.fn>;
    DeleteSandbox!: ReturnType<typeof vi.fn>;
    GetSandboxLogs!: ReturnType<typeof vi.fn>;
    UpdateConfig!: ReturnType<typeof vi.fn>;
    GetSandboxPolicyStatus!: ReturnType<typeof vi.fn>;
    ExecSandbox!: ReturnType<typeof vi.fn>;
    close!: ReturnType<typeof vi.fn>;
    constructor(endpoint: string, creds: unknown) {
      this.endpoint = endpoint;
      this.creds = creds;
      last = this;
    }
  }
  return { FakeService, getLastService: () => last as FakeService };
});

vi.mock("../src/proto-loader.js", () => ({
  loadProto: () => ({ OpenShellService: FakeService }),
}));

import { OpenShellClient, type ClientOptions } from "../src/openshell-client.js";

const TIMEOUTS: ClientOptions["timeouts"] = {
  connect: 15_000,
  create: 120_000,
  destroy: 60_000,
  exec: 120_000,
  list: 15_000,
  get: 15_000,
  logs: 15_000,
  policySet: 60_000,
  policyStatus: 15_000,
};

const OPTIONS: ClientOptions = {
  endpoint: "127.0.0.1:8080",
  tls: { mode: "insecure" },
  timeouts: TIMEOUTS,
};

function attachMocks(svc: FakeServiceType): void {
  svc.Health = vi.fn();
  svc.CreateSandbox = vi.fn();
  svc.GetSandbox = vi.fn();
  svc.ListSandboxes = vi.fn();
  svc.DeleteSandbox = vi.fn();
  svc.GetSandboxLogs = vi.fn();
  svc.UpdateConfig = vi.fn();
  svc.GetSandboxPolicyStatus = vi.fn();
  svc.ExecSandbox = vi.fn();
  svc.close = vi.fn();
}

// Local alias for the hoisted class instance shape (TS can't see through vi.hoisted).
type FakeServiceType = {
  endpoint: string;
  creds: unknown;
  Health: ReturnType<typeof vi.fn>;
  CreateSandbox: ReturnType<typeof vi.fn>;
  GetSandbox: ReturnType<typeof vi.fn>;
  ListSandboxes: ReturnType<typeof vi.fn>;
  DeleteSandbox: ReturnType<typeof vi.fn>;
  GetSandboxLogs: ReturnType<typeof vi.fn>;
  UpdateConfig: ReturnType<typeof vi.fn>;
  GetSandboxPolicyStatus: ReturnType<typeof vi.fn>;
  ExecSandbox: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type UnaryCb = (err: grpc.ServiceError | null, res?: unknown) => void;

function makeStream(): EventEmitter & { cancel: ReturnType<typeof vi.fn> } {
  const ee = new EventEmitter() as EventEmitter & { cancel: ReturnType<typeof vi.fn> };
  ee.cancel = vi.fn();
  return ee;
}

describe("OpenShellClient", () => {
  describe("constructor", () => {
    test("forwards endpoint + credentials to the underlying service constructor", () => {
      new OpenShellClient(OPTIONS);
      const svc = getLastService() as unknown as FakeServiceType;
      expect(svc.endpoint).toBe("127.0.0.1:8080");
      expect(svc.creds).toBeDefined();
    });
  });

  describe("unary RPCs", () => {
    let client: OpenShellClient;
    let svc: FakeServiceType;

    beforeEach(() => {
      client = new OpenShellClient(OPTIONS);
      svc = getLastService() as unknown as FakeServiceType;
      attachMocks(svc);
    });

    test("health() sends an empty request and resolves with the response", async () => {
      svc.Health.mockImplementation((_req: unknown, _meta: unknown, _opts: unknown, cb: UnaryCb) => {
        cb(null, { status: "SERVING" });
      });
      const result = await client.health();
      expect(result).toEqual({ status: "SERVING" });
      expect(svc.Health).toHaveBeenCalledTimes(1);
      const [req] = svc.Health.mock.calls[0]!;
      expect(req).toEqual({});
    });

    test("health() rejects when the RPC returns an error", async () => {
      const err = Object.assign(new Error("unavailable"), {
        code: grpc.status.UNAVAILABLE,
        details: "unavailable",
        metadata: new grpc.Metadata(),
      });
      svc.Health.mockImplementation((_r, _m, _o, cb: UnaryCb) => cb(err));
      await expect(client.health()).rejects.toThrow(/unavailable/);
    });

    test("each unary method uses its own timeout as a gRPC deadline", async () => {
      svc.GetSandbox.mockImplementation((_r, _m, _o, cb: UnaryCb) => cb(null, {}));
      svc.CreateSandbox.mockImplementation((_r, _m, _o, cb: UnaryCb) => cb(null, {}));
      const before = Date.now();
      await client.getSandbox({ name: "foo" });
      await client.createSandbox({ name: "foo" });
      const after = Date.now();

      const getOpts = svc.GetSandbox.mock.calls[0]![2] as grpc.CallOptions;
      const createOpts = svc.CreateSandbox.mock.calls[0]![2] as grpc.CallOptions;

      expect(getOpts.deadline).toBeInstanceOf(Date);
      expect(createOpts.deadline).toBeInstanceOf(Date);

      const getTs = (getOpts.deadline as Date).getTime();
      const createTs = (createOpts.deadline as Date).getTime();

      // get timeout = 15s, create timeout = 120s
      expect(getTs).toBeGreaterThanOrEqual(before + 15_000);
      expect(getTs).toBeLessThanOrEqual(after + 15_000);
      expect(createTs).toBeGreaterThanOrEqual(before + 120_000);
      expect(createTs).toBeLessThanOrEqual(after + 120_000);
    });

    test("createSandbox / getSandbox / listSandboxes / deleteSandbox / getSandboxLogs / updateConfig / getSandboxPolicyStatus forward their request", async () => {
      svc.CreateSandbox.mockImplementation((_r, _m, _o, cb: UnaryCb) => cb(null, { tag: "create" }));
      svc.GetSandbox.mockImplementation((_r, _m, _o, cb: UnaryCb) => cb(null, { tag: "get" }));
      svc.ListSandboxes.mockImplementation((_r, _m, _o, cb: UnaryCb) => cb(null, { tag: "list" }));
      svc.DeleteSandbox.mockImplementation((_r, _m, _o, cb: UnaryCb) => cb(null, { tag: "delete" }));
      svc.GetSandboxLogs.mockImplementation((_r, _m, _o, cb: UnaryCb) => cb(null, { tag: "logs" }));
      svc.UpdateConfig.mockImplementation((_r, _m, _o, cb: UnaryCb) => cb(null, { tag: "update" }));
      svc.GetSandboxPolicyStatus.mockImplementation((_r, _m, _o, cb: UnaryCb) => cb(null, { tag: "policy" }));

      const req = { x: 1 };
      await expect(client.createSandbox(req)).resolves.toEqual({ tag: "create" });
      await expect(client.getSandbox(req)).resolves.toEqual({ tag: "get" });
      await expect(client.listSandboxes(req)).resolves.toEqual({ tag: "list" });
      await expect(client.deleteSandbox(req)).resolves.toEqual({ tag: "delete" });
      await expect(client.getSandboxLogs(req)).resolves.toEqual({ tag: "logs" });
      await expect(client.updateConfig(req)).resolves.toEqual({ tag: "update" });
      await expect(client.getSandboxPolicyStatus(req)).resolves.toEqual({ tag: "policy" });

      for (const fn of [svc.CreateSandbox, svc.GetSandbox, svc.ListSandboxes, svc.DeleteSandbox, svc.GetSandboxLogs, svc.UpdateConfig, svc.GetSandboxPolicyStatus]) {
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn.mock.calls[0]![0]).toBe(req);
      }
    });
  });

  describe("execSandbox (server streaming)", () => {
    let client: OpenShellClient;
    let svc: FakeServiceType;

    beforeEach(() => {
      client = new OpenShellClient(OPTIONS);
      svc = getLastService() as unknown as FakeServiceType;
      attachMocks(svc);
    });

    test("aggregates stdout / stderr bytes across events and reports exit code", async () => {
      const stream = makeStream();
      svc.ExecSandbox.mockReturnValue(stream);

      const promise = client.execSandbox({ sandbox_id: "s1", command: ["echo", "hi"] });

      setImmediate(() => {
        stream.emit("data", { stdout: { data: Buffer.from("hel") } });
        stream.emit("data", { stdout: { data: Buffer.from("lo") } });
        stream.emit("data", { stderr: { data: Buffer.from("warn") } });
        stream.emit("data", { exit: { exit_code: 0 } });
        stream.emit("end");
      });

      const result = await promise;
      expect(result.stdout.toString("utf8")).toBe("hello");
      expect(result.stderr.toString("utf8")).toBe("warn");
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("marks timedOut=true when the stream errors with DEADLINE_EXCEEDED", async () => {
      const stream = makeStream();
      svc.ExecSandbox.mockReturnValue(stream);
      const promise = client.execSandbox({ sandbox_id: "s1", command: ["sleep", "9999"] });

      setImmediate(() => {
        const err = Object.assign(new Error("deadline"), { code: grpc.status.DEADLINE_EXCEEDED });
        stream.emit("error", err);
      });

      const result = await promise;
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
    });

    test("propagates non-deadline stream errors", async () => {
      const stream = makeStream();
      svc.ExecSandbox.mockReturnValue(stream);
      const promise = client.execSandbox({ sandbox_id: "s1", command: [] });

      setImmediate(() => {
        const err = Object.assign(new Error("boom"), { code: grpc.status.INTERNAL });
        stream.emit("error", err);
      });

      await expect(promise).rejects.toThrow(/boom/);
    });

    test("cancels the stream when the AbortSignal fires", async () => {
      const stream = makeStream();
      svc.ExecSandbox.mockReturnValue(stream);
      const ctrl = new AbortController();
      const promise = client.execSandbox({ sandbox_id: "s1", command: [] }, ctrl.signal);

      setImmediate(() => {
        ctrl.abort();
        // Real gRPC emits end after cancel; mimic that so the promise resolves.
        stream.emit("end");
      });

      await promise;
      expect(stream.cancel).toHaveBeenCalledTimes(1);
    });

    test("cancels immediately if signal is already aborted", async () => {
      const stream = makeStream();
      svc.ExecSandbox.mockReturnValue(stream);
      const ctrl = new AbortController();
      ctrl.abort();
      const promise = client.execSandbox({ sandbox_id: "s1", command: [] }, ctrl.signal);
      setImmediate(() => stream.emit("end"));
      await promise;
      expect(stream.cancel).toHaveBeenCalledTimes(1);
    });

    test("attaches exec deadline to the call options", async () => {
      const stream = makeStream();
      svc.ExecSandbox.mockReturnValue(stream);
      const before = Date.now();
      const promise = client.execSandbox({ sandbox_id: "s1", command: [] });
      setImmediate(() => stream.emit("end"));
      const after = Date.now();
      await promise;

      const opts = svc.ExecSandbox.mock.calls[0]![2] as grpc.CallOptions;
      expect(opts.deadline).toBeInstanceOf(Date);
      const ts = (opts.deadline as Date).getTime();
      // exec timeout = 120s
      expect(ts).toBeGreaterThanOrEqual(before + 120_000);
      expect(ts).toBeLessThanOrEqual(after + 120_000);
    });
  });

  describe("close", () => {
    test("calls the underlying client's close()", () => {
      const client = new OpenShellClient(OPTIONS);
      const svc = getLastService() as unknown as FakeServiceType;
      attachMocks(svc);
      client.close();
      expect(svc.close).toHaveBeenCalledTimes(1);
    });
  });
});
