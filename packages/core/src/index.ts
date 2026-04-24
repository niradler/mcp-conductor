export const VERSION = "0.2.0";

export { createLogger } from "./logger/index.js";
export type { Logger, LogLevel } from "./logger/index.js";

export { initTelemetry, shutdownTelemetry, getTracer, getMeter } from "./telemetry/index.js";

export { createShutdownRegistry } from "./lifecycle/shutdown.js";
export type { ShutdownRegistry, ShutdownOptions } from "./lifecycle/shutdown.js";

export { ok, err } from "./types/shared.js";
export type { Result, Timed } from "./types/shared.js";

export { ConfigError, AuthError, ProviderError, SandboxError } from "./errors/index.js";
export type { SandboxErrorType } from "./errors/index.js";

export * from "./providers/index.js";
export * from "./data/index.js";
