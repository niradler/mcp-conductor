export type LogLevel = "debug" | "info" | "warn" | "error";

const PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

function serializeCtx(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
  }
  return out;
}

function resolveLevel(override?: LogLevel): LogLevel {
  if (override) return override;
  const env = process.env.LOG_LEVEL as LogLevel | undefined;
  return env && PRIORITY[env] !== undefined ? env : "info";
}

export function createLogger(scope: string, levelOverride?: LogLevel): Logger {
  const level = resolveLevel(levelOverride);
  const min = PRIORITY[level];

  function log(lvl: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (PRIORITY[lvl] < min) return;
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: lvl,
        scope,
        msg,
        ...(ctx ? serializeCtx(ctx) : {}),
      }),
    );
  }

  return {
    debug: (m, c) => log("debug", m, c),
    info: (m, c) => log("info", m, c),
    warn: (m, c) => log("warn", m, c),
    error: (m, c) => log("error", m, c),
    child: (c) => createLogger(`${scope}.${c}`, level),
  };
}
