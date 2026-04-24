import { createLogger, type Logger } from "../logger/index.js";

export interface ShutdownRegistry {
  register(name: string, fn: () => Promise<void> | void): void;
  shutdown(reason: string): Promise<void>;
}

export interface ShutdownOptions {
  registerSignals?: boolean;
  timeoutMs?: number;
  logger?: Pick<Logger, "info" | "error">;
}

export function createShutdownRegistry(options: ShutdownOptions = {}): ShutdownRegistry {
  const registerSignals = options.registerSignals ?? true;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const log = options.logger ?? createLogger("lifecycle");
  const handlers: { name: string; fn: () => Promise<void> | void }[] = [];
  let running: Promise<void> | null = null;

  async function runAll(reason: string): Promise<void> {
    log.info("shutdown", { reason, count: handlers.length });
    for (let i = handlers.length - 1; i >= 0; i--) {
      const h = handlers[i]!;
      try {
        await h.fn();
        log.info("handler done", { name: h.name });
      } catch (error) {
        log.error("handler failed", { name: h.name, error });
      }
    }
  }

  function shutdown(reason: string): Promise<void> {
    if (running) return running;
    running = (async () => {
      const forced = new Promise<void>((resolve) => {
        setTimeout(() => {
          log.error("shutdown timeout; forcing", { timeoutMs });
          resolve();
        }, timeoutMs).unref();
      });
      await Promise.race([runAll(reason), forced]);
    })();
    return running;
  }

  if (registerSignals) {
    const handle = (signal: NodeJS.Signals) => {
      shutdown(`signal:${signal}`).then(() => process.exit(0));
    };
    process.on("SIGINT", handle);
    process.on("SIGTERM", handle);
  }

  return {
    register(name, fn) {
      handlers.push({ name, fn });
    },
    shutdown,
  };
}
