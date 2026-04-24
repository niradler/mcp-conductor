import * as grpc from "@grpc/grpc-js";
import { loadProto } from "./proto-loader.js";
import { buildChannelCredentials, type TlsOptions } from "./credentials.js";

export interface ClientOptions {
  endpoint: string;
  tls: TlsOptions;
  timeouts: {
    connect: number;
    create: number;
    destroy: number;
    exec: number;
    list: number;
    get: number;
    logs: number;
    policySet: number;
    policyStatus: number;
  };
}

export interface ExecResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

type UnaryCallback = (err: grpc.ServiceError | null, res?: unknown) => void;

type UnaryMethod = (
  req: unknown,
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
  callback: UnaryCallback,
) => grpc.ClientUnaryCall;

type StreamMethod = (
  req: unknown,
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
) => grpc.ClientReadableStream<unknown>;

interface RawClient {
  Health: UnaryMethod;
  CreateSandbox: UnaryMethod;
  GetSandbox: UnaryMethod;
  ListSandboxes: UnaryMethod;
  DeleteSandbox: UnaryMethod;
  GetSandboxLogs: UnaryMethod;
  UpdateConfig: UnaryMethod;
  GetSandboxPolicyStatus: UnaryMethod;
  ExecSandbox: StreamMethod;
  close(): void;
}

interface ExecEvent {
  stdout?: { data: Buffer };
  stderr?: { data: Buffer };
  exit?: { exit_code: number };
}

function deadlineAfter(ms: number): Date {
  return new Date(Date.now() + ms);
}

function unary(method: UnaryMethod, req: unknown, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    method(req, new grpc.Metadata(), { deadline: deadlineAfter(timeoutMs) }, (err, res) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(res);
    });
  });
}

export class OpenShellClient {
  private readonly raw: RawClient;

  constructor(private readonly options: ClientOptions) {
    const { OpenShellService } = loadProto();
    const creds = buildChannelCredentials(options.tls);
    this.raw = new OpenShellService(options.endpoint, creds) as unknown as RawClient;
  }

  health(): Promise<unknown> {
    return unary(this.raw.Health.bind(this.raw), {}, this.options.timeouts.connect);
  }

  createSandbox(req: unknown): Promise<unknown> {
    return unary(this.raw.CreateSandbox.bind(this.raw), req, this.options.timeouts.create);
  }

  getSandbox(req: unknown): Promise<unknown> {
    return unary(this.raw.GetSandbox.bind(this.raw), req, this.options.timeouts.get);
  }

  listSandboxes(req: unknown): Promise<unknown> {
    return unary(this.raw.ListSandboxes.bind(this.raw), req, this.options.timeouts.list);
  }

  deleteSandbox(req: unknown): Promise<unknown> {
    return unary(this.raw.DeleteSandbox.bind(this.raw), req, this.options.timeouts.destroy);
  }

  getSandboxLogs(req: unknown): Promise<unknown> {
    return unary(this.raw.GetSandboxLogs.bind(this.raw), req, this.options.timeouts.logs);
  }

  updateConfig(req: unknown): Promise<unknown> {
    return unary(this.raw.UpdateConfig.bind(this.raw), req, this.options.timeouts.policySet);
  }

  getSandboxPolicyStatus(req: unknown): Promise<unknown> {
    return unary(
      this.raw.GetSandboxPolicyStatus.bind(this.raw),
      req,
      this.options.timeouts.policyStatus,
    );
  }

  async execSandbox(req: unknown, signal?: AbortSignal): Promise<ExecResult> {
    const started = Date.now();
    const stream = this.raw.ExecSandbox(req, new grpc.Metadata(), {
      deadline: deadlineAfter(this.options.timeouts.exec),
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let exitCode: number | null = null;
    let timedOut = false;

    const onAbort = (): void => stream.cancel();
    if (signal?.aborted) {
      stream.cancel();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }

    try {
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (event: ExecEvent) => {
          if (event.stdout) stdout.push(Buffer.from(event.stdout.data));
          else if (event.stderr) stderr.push(Buffer.from(event.stderr.data));
          else if (event.exit) exitCode = event.exit.exit_code;
        });
        stream.on("error", (err: grpc.ServiceError) => {
          if (err.code === grpc.status.DEADLINE_EXCEEDED) {
            timedOut = true;
            resolve();
            return;
          }
          reject(err);
        });
        stream.on("end", () => resolve());
      });
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    return {
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
      exitCode,
      durationMs: Date.now() - started,
      timedOut,
    };
  }

  close(): void {
    this.raw.close();
  }
}
