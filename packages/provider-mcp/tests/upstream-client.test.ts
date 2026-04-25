import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { UpstreamClient } from "../src/upstream-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const STUB = resolve(here, "fixtures/stub-mcp-server.ts");
// Use tsx to run the TypeScript stub directly
const TSX = process.platform === "win32" ? "tsx.CMD" : "tsx";

describe("UpstreamClient (with stub)", () => {
  let client: UpstreamClient;
  beforeEach(() => {
    client = new UpstreamClient({
      name: "stub",
      transport: "stdio",
      command: TSX,
      args: [STUB],
      env: {},
      initialListTimeoutMs: 10_000,
      callTimeoutMs: 5_000,
      reconnect: { maxAttempts: 2, initialDelayMs: 50, maxDelayMs: 200 },
    });
  });
  afterEach(async () => {
    await client.close();
  });

  test("connects and lists tools", async () => {
    await client.connect();
    const tools = await client.list();
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "throw"]);
  });

  test("calls a tool and returns content", async () => {
    await client.connect();
    const r = await client.call("echo", { text: "hi" });
    expect(r.content[0]).toMatchObject({ type: "text", text: "hi" });
  });

  test("propagates upstream tool errors as isError", async () => {
    await client.connect();
    const r = await client.call("throw", {});
    expect(r.isError).toBe(true);
  });

  test("callTimeoutMs enforced with AbortSignal", async () => {
    await client.connect();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    const p = client.call("slow", { ms: 5000 }, ctrl.signal);
    await expect(p).rejects.toThrow();
  });

  test("close twice is idempotent", async () => {
    await client.connect();
    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
  });
});
