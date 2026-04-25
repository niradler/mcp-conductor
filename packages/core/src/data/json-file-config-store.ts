import { readFile } from "node:fs/promises";
import type { ZodType, ZodTypeDef } from "zod";
import { ConfigError } from "../errors/index.js";
import type { ConfigStore } from "./config-store.js";

export interface JsonFileConfigStoreOptions<T> {
  path: string;
  schema: ZodType<T, ZodTypeDef, any>;
}

export class JsonFileConfigStore<T> implements ConfigStore<T> {
  readonly source: string;
  private readonly schema: ZodType<T, ZodTypeDef, any>;
  private cached: T | null = null;

  constructor(options: JsonFileConfigStoreOptions<T>) {
    this.source = options.path;
    this.schema = options.schema;
  }

  async load(): Promise<T> {
    if (this.cached !== null) return this.cached;
    return this.reload();
  }

  async reload(): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(this.source, "utf8");
    } catch (e) {
      throw new ConfigError(`cannot read config: ${(e as Error).message}`, this.source);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new ConfigError(`invalid JSON: ${(e as Error).message}`, this.source);
    }

    const result = this.schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      throw new ConfigError(`config validation failed: ${issues}`, this.source);
    }
    this.cached = result.data;
    return this.cached;
  }
}
