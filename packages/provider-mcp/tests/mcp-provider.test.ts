import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { McpProvider } from "../src/mcp-provider.js";

const here = dirname(fileURLToPath(import.meta.url));
const STUB = resolve(here, "fixtures/stub-mcp-server.ts");
const TSX = process.platform === "win32" ? "tsx.CMD" : "tsx";

describe("McpProvider", () => {
  let provider: McpProvider;
  beforeEach(() => {
    provider = new McpProvider({
      name: "stub",
      transport: "stdio",
      command: TSX,
      args: [STUB],
      env: {},
      initialListTimeoutMs: 10_000,
      callTimeoutMs: 5_000,
      reconnect: { maxAttempts: 1, initialDelayMs: 10, maxDelayMs: 20 },
    });
  });
  afterEach(async () => {
    await provider.close();
  });

  test("connects and listTools returns upstream tools", async () => {
    await provider.connect();
    const tools = await provider.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "throw"]);
  });
  test("callTool happy path", async () => {
    await provider.connect();
    const r = await provider.callTool("echo", { text: "x" }, { user: "u" });
    expect(r.content[0]).toMatchObject({ type: "text", text: "x" });
  });
  test("callTool surfaces upstream throw as isError", async () => {
    await provider.connect();
    const r = await provider.callTool("throw", {}, { user: "u" });
    expect(r.isError).toBe(true);
  });
  test("name is exposed on provider", () => {
    expect(provider.name).toBe("stub");
  });
});
