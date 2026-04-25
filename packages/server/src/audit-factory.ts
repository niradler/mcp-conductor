import { ConsoleAuditStore, type AuditStore } from "@conductor/core";
import type { AuditConfig } from "./conductor-config.js";

export function createAuditStore(cfg: AuditConfig): AuditStore {
  if (cfg.type === "console") {
    return new ConsoleAuditStore({ bufferSize: cfg.bufferSize });
  }
  // Exhaustiveness guard — Zod prevents reaching here, but keep for future variants.
  throw new Error(`unknown audit.type: ${(cfg as { type: string }).type}`);
}
