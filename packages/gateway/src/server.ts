import { createServer, type Server as HttpServer } from "node:http";
import {
  createLogger, createShutdownRegistry,
  type AuditStore, type ProviderRegistry, type Logger,
} from "@mcp-conductor/core";
import { exportMcpApp, type ExportedMcpApp } from "./mcp-app.js";
import { GatewayErrorCode, writeErrorResponse } from "./errors.js";
import type { GatewayConfig } from "./config.js";

export interface StartGatewayOptions {
  config: GatewayConfig;
  registry: ProviderRegistry;
  auditStore: AuditStore;
  logger?: Logger;
  /** If true, bind SIGINT/SIGTERM to graceful shutdown. Default true. */
  manageSignals?: boolean;
  /** Optional per-provider audit redaction. Returns extra arg keys to replace with [REDACTED]. */
  redactKeysForProvider?: (providerName: string) => string[];
}

export interface StartGatewayResult {
  address: string;
  app: ExportedMcpApp;
  server: HttpServer;
  close(): Promise<void>;
}

export async function startGateway(opts: StartGatewayOptions): Promise<StartGatewayResult> {
  const log = opts.logger ?? createLogger("gateway");
  const app = exportMcpApp({
    config: opts.config,
    registry: opts.registry,
    auditStore: opts.auditStore,
    logger: log,
    ...(opts.redactKeysForProvider ? { redactKeysForProvider: opts.redactKeysForProvider } : {}),
  });

  const server = createServer(async (req, res) => {
    try {
      if (await app.handleRequest(req, res)) return;
      // Fall through to Hono for /health etc.
      const host = req.headers.host ?? "localhost";
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers[k] = v;
        else if (Array.isArray(v)) headers[k] = v.join(", ");
      }
      const response = await app.honoApp.fetch(
        new Request(`http://${host}${req.url}`, {
          method: req.method,
          headers,
        }),
      );
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      const body = await response.arrayBuffer();
      res.end(Buffer.from(body));
    } catch (err) {
      log.error("request handler failed", { err });
      writeErrorResponse(res, 500, GatewayErrorCode.InternalError, "internal error");
    }
  });

  await new Promise<void>((resolve) =>
    server.listen(opts.config.server.port, opts.config.server.host, () => resolve()),
  );
  const addr = server.address();
  const address = typeof addr === "string"
    ? addr
    : `http://${addr?.address === "::" || addr?.address === "0.0.0.0" ? "127.0.0.1" : addr?.address}:${addr?.port}`;
  log.info("gateway listening", { address });

  const registry = createShutdownRegistry({ registerSignals: opts.manageSignals ?? true, logger: log });
  registry.register("http-server", () => new Promise<void>((r) => server.close(() => r())));
  registry.register("sessions", () => app.closeSessions());
  registry.register("providers", () => opts.registry.closeAll());
  registry.register("audit", () => opts.auditStore.close());

  return {
    address,
    app,
    server,
    close: () => registry.shutdown("api"),
  };
}

export { exportMcpApp } from "./mcp-app.js";
