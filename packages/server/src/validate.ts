import { readFile, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { hashApiKey } from "@conductor/gateway";
import { ConductorConfigSchema, type ConductorConfig } from "./conductor-config.js";

export interface ValidationResult {
  /** Whether the config is structurally valid (errors empty). Warnings do not affect this. */
  ok: boolean;
  /** Fatal problems — config will not start. */
  errors: string[];
  /** Non-fatal advisories (e.g., insecure defaults, missing PATH binaries). */
  warnings: string[];
  /** Parsed config, when schema validation succeeded. */
  config?: ConductorConfig;
}

/** Plaintext keys we recognise as obviously insecure samples. */
const KNOWN_WEAK_KEYS = ["changeme", "password", "secret", "test", "admin"];

/**
 * Validate a conductor.json file end-to-end without starting the server.
 * Errors block startup; warnings flag risky-but-valid configurations.
 */
export async function validateConfigFile(path: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    errors.push(`cannot read config: ${(e as Error).message}`);
    return { ok: false, errors, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    errors.push(`invalid JSON: ${(e as Error).message}`);
    return { ok: false, errors, warnings };
  }

  const schemaResult = ConductorConfigSchema.safeParse(parsed);
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      const where = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      errors.push(`${where}: ${issue.message}`);
    }
    return { ok: false, errors, warnings };
  }

  const config = schemaResult.data;
  validateCrossReferences(config, errors);
  await validateProviderCommands(config, warnings);
  validateApiKeys(config, warnings);
  validateAuditAndServer(config, warnings);
  validateFilters(config, warnings);

  return { ok: errors.length === 0, errors, warnings, config };
}

function validateCrossReferences(config: ConductorConfig, errors: string[]): void {
  const groupNames = new Set(config.groups.map((g) => g.name));
  const providerNames = new Set(config.providers.map((p) => p.name));

  const seenUsers = new Set<string>();
  for (const u of config.users) {
    if (seenUsers.has(u.name)) errors.push(`duplicate user name: ${u.name}`);
    seenUsers.add(u.name);
    for (const g of u.groups) {
      if (!groupNames.has(g)) errors.push(`user "${u.name}" references unknown group "${g}"`);
    }
  }

  const seenGroups = new Set<string>();
  for (const g of config.groups) {
    if (seenGroups.has(g.name)) errors.push(`duplicate group name: ${g.name}`);
    seenGroups.add(g.name);
    for (const p of g.providers) {
      if (p === "*") continue;
      if (!providerNames.has(p)) errors.push(`group "${g.name}" references unknown provider "${p}"`);
    }
  }

  const seenProviders = new Set<string>();
  for (const p of config.providers) {
    if (seenProviders.has(p.name)) errors.push(`duplicate provider name: ${p.name}`);
    seenProviders.add(p.name);
  }
}

async function validateProviderCommands(config: ConductorConfig, warnings: string[]): Promise<void> {
  for (const provider of config.providers) {
    if (provider.type !== "mcp") continue;
    const found = await commandExists(provider.command);
    if (!found) {
      warnings.push(
        `provider "${provider.name}": command "${provider.command}" not found on PATH (may still work at runtime if installed later)`,
      );
    }
  }
}

function validateApiKeys(config: ConductorConfig, warnings: string[]): void {
  const weakHashes = new Set(KNOWN_WEAK_KEYS.map((k) => hashApiKey(k)));
  for (const u of config.users) {
    if (weakHashes.has(u.apiKeyHash)) {
      warnings.push(
        `user "${u.name}": apiKeyHash matches a well-known weak key — rotate before exposing the gateway`,
      );
    }
  }
}

function validateAuditAndServer(config: ConductorConfig, warnings: string[]): void {
  if (config.audit.type === "console") {
    warnings.push(`audit.type is "console" — entries are not persisted; use a durable store in production`);
  }
  if (config.server.host === "0.0.0.0") {
    warnings.push(`server.host is "0.0.0.0" — gateway will accept connections from any interface; ensure TLS termination upstream`);
  }
}

function validateFilters(config: ConductorConfig, warnings: string[]): void {
  for (const provider of config.providers) {
    if (provider.type !== "mcp") continue;
    const allow = provider.allow_tools ?? [];
    const exclude = provider.exclude_tools ?? [];
    if (allow.length > 0 && exclude.length > 0) {
      const overlap = allow.filter((a) => exclude.includes(a));
      if (overlap.length > 0) {
        warnings.push(
          `provider "${provider.name}": tool(s) [${overlap.join(", ")}] appear in both allow_tools and exclude_tools — exclude wins`,
        );
      }
    }
  }
}

/** Best-effort `which` implementation — returns true if the binary resolves on PATH. */
async function commandExists(command: string): Promise<boolean> {
  if (!command) return false;
  if (isAbsolute(command) || command.startsWith("./") || command.startsWith("../")) {
    return fileIsAccessible(resolve(command));
  }
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  if (!pathEnv) return false;
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      if (await fileIsAccessible(candidate)) return true;
    }
  }
  return false;
}

async function fileIsAccessible(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/** Format a result for human-readable CLI output. Returns the rendered string. */
export function formatValidationResult(path: string, result: ValidationResult): string {
  const lines: string[] = [];
  lines.push(`config: ${path}`);
  if (result.errors.length === 0) {
    lines.push(`✔ valid`);
  } else {
    lines.push(`✘ invalid (${result.errors.length} error${result.errors.length === 1 ? "" : "s"})`);
    for (const err of result.errors) lines.push(`  error: ${err}`);
  }
  if (result.warnings.length > 0) {
    lines.push(`${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}:`);
    for (const w of result.warnings) lines.push(`  warning: ${w}`);
  }
  return lines.join("\n");
}
