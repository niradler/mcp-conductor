import type { ZodType } from "zod";
import {
  JsonFileConfigStore,
  ProviderRegistry,
  createLogger,
  initTelemetry,
  shutdownTelemetry,
  type AuditStore,
  type Logger,
} from "@mcp-conductor/core";
import { startGateway, type StartGatewayResult } from "@mcp-conductor/gateway";
import { ConductorConfigSchema, type ConductorConfig } from "./conductor-config.js";
import { createAuditStore } from "./audit-factory.js";
import { createProvider } from "./provider-factory.js";

export interface MainOptions {
  /** If true, gateway registers SIGINT/SIGTERM handlers. Default: false (caller manages). */
  manageSignals?: boolean;
  logger?: Logger;
}

export interface MainResult {
  config: ConductorConfig;
  gateway: StartGatewayResult;
  registry: ProviderRegistry;
  auditStore: AuditStore;
  shutdown(): Promise<void>;
}

export async function main(configPath: string, options: MainOptions = {}): Promise<MainResult> {
  const log = options.logger ?? createLogger("server");
  // Cast: `ZodType<T>` in core requires input === output, but our schema uses
  // `.default()` on some fields (input allows undefined, output is concrete).
  // The runtime parse always yields the output shape, so this cast is safe.
  const store = new JsonFileConfigStore<ConductorConfig>({
    path: configPath,
    schema: ConductorConfigSchema as unknown as ZodType<ConductorConfig>,
  });
  const config = await store.load();

  initTelemetry(config.telemetry.serviceName);

  const registry = new ProviderRegistry();
  for (const entry of config.providers) registry.register(createProvider(entry));
  await registry.connectAll();

  const auditStore = createAuditStore(config.audit);

  const gateway = await startGateway({
    config,
    registry,
    auditStore,
    logger: log,
    manageSignals: options.manageSignals ?? false,
  });
  log.info("mcp-conductor ready", { address: gateway.address, providers: registry.names() });

  return {
    config,
    gateway,
    registry,
    auditStore,
    async shutdown() {
      await gateway.close(); // closes HTTP, sessions, providers, audit via the gateway's shutdown registry
      await shutdownTelemetry();
    },
  };
}
