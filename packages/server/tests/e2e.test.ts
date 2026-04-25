import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { hashApiKey } from "@conductor/gateway";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = dirname(fileURLToPath(import.meta.url));
const STUB = resolve(here, "../../provider-mcp/tests/fixtures/stub-mcp-server.ts");
const CLI = resolve(here, "../dist/cli.js");
const TSX = process.platform === "win32" ? "tsx.CMD" : "tsx";

async function waitForHealth(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `gateway did not become healthy within ${timeoutMs}ms: ${String(lastErr)}`,
  );
}

describe("e2e CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "conductor-cli-"));
  const configPath = join(dir, "conductor.json");
  const port = 38727;
  let child: ChildProcess | null = null;

  beforeAll(async () => {
    if (!existsSync(CLI)) {
      throw new Error(
        `dist/cli.js missing at ${CLI}. Run "pnpm -F @conductor/server build" before vitest.`,
      );
    }
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          server: { host: "127.0.0.1", port, maxSessions: 10 },
          users: [
            { name: "alice", apiKeyHash: hashApiKey("alice-key"), groups: ["admin"] },
          ],
          groups: [{ name: "admin", providers: ["*"] }],
          providers: [
            {
              type: "mcp",
              name: "stub",
              transport: "stdio",
              command: TSX,
              args: [STUB],
              env: {},
            },
          ],
          audit: { type: "console" },
          telemetry: { serviceName: "e2e", otlpEndpoint: "" },
        },
        null,
        2,
      ),
    );
    child = spawn("node", [CLI], {
      env: { ...process.env, CONDUCTOR_CONFIG: configPath },
      stdio: ["ignore", "inherit", "inherit"],
    });
    await waitForHealth(`http://127.0.0.1:${port}/health`);
  }, 30_000);

  afterAll(async () => {
    if (child) {
      child.kill("SIGTERM");
      // Give it a moment to wind down.
      await new Promise((r) => setTimeout(r, 200));
      if (!child.killed) child.kill("SIGKILL");
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("client lists namespaced tool from stub and calls it", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      { requestInit: { headers: { Authorization: "Bearer alice-key" } } },
    );
    const client = new Client({ name: "e2e", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toContain("stub__echo");
    const res = await client.callTool({
      name: "stub__echo",
      arguments: { text: "roundtrip" },
    });
    const content = (res.content as Array<{ type: string; text: string }>)[0];
    expect(content).toMatchObject({ type: "text", text: "roundtrip" });
    await client.close();
  }, 30_000);
});
