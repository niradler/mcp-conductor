import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { JsonFileConfigStore } from "../../src/data/json-file-config-store.js";
import { ConfigError } from "../../src/errors/index.js";

const Schema = z.object({ port: z.number(), name: z.string() });

describe("JsonFileConfigStore", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cfg-"));
    path = join(dir, "c.json");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("loads and validates", async () => {
    writeFileSync(path, JSON.stringify({ port: 1, name: "x" }));
    const store = new JsonFileConfigStore({ path, schema: Schema });
    const v = await store.load();
    expect(v).toEqual({ port: 1, name: "x" });
  });

  test("caches; reload re-reads", async () => {
    writeFileSync(path, JSON.stringify({ port: 1, name: "x" }));
    const store = new JsonFileConfigStore({ path, schema: Schema });
    await store.load();
    writeFileSync(path, JSON.stringify({ port: 2, name: "y" }));
    expect((await store.load()).port).toBe(1);
    expect((await store.reload()).port).toBe(2);
  });

  test("missing file throws ConfigError", async () => {
    const store = new JsonFileConfigStore({ path: join(dir, "nope.json"), schema: Schema });
    await expect(store.load()).rejects.toBeInstanceOf(ConfigError);
  });

  test("invalid JSON throws ConfigError", async () => {
    writeFileSync(path, "{not json");
    const store = new JsonFileConfigStore({ path, schema: Schema });
    await expect(store.load()).rejects.toThrow(/invalid JSON/);
  });

  test("schema mismatch throws ConfigError with path", async () => {
    writeFileSync(path, JSON.stringify({ port: "nope", name: 123 }));
    const store = new JsonFileConfigStore({ path, schema: Schema });
    await expect(store.load()).rejects.toThrow(/port:.*[Ee]xpected number/);
  });
});
