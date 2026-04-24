export const VERSION = "0.2.0";
export { main } from "./main.js";
export type { MainOptions, MainResult } from "./main.js";
export {
  ConductorConfigSchema,
  McpProviderEntrySchema,
  ProviderEntrySchema,
  AuditConfigSchema,
  TelemetryConfigSchema,
} from "./conductor-config.js";
export type {
  ConductorConfig,
  ProviderEntry,
  McpProviderEntry,
  AuditConfig,
} from "./conductor-config.js";
export { createAuditStore } from "./audit-factory.js";
export { createProvider } from "./provider-factory.js";
