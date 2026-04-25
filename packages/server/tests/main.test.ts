import { describe, test, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { hashApiKey } from "@conductor/gateway";
import { main, type MainResult } from "../src/main.js";

const here = dirname(fileURLToPath(import.meta.url));
const STUB = resolve(here, "../../provider-mcp/tests/fixtures/stub-mcp-server.ts");
const TSX = process.platform === "win32" ? "tsx.CMD" : "tsx";

describe("main()", () => {
  let running: MainResult | null = null;
  const dir = mkdtempSync(join(tmpdir(), "conductor-"));
  const configPath = join(dir, "conductor.json");

  afterEach(async () => {
    if (running) {
      await running.shutdown();
      running = null;
    }
  });

  test("starts a gateway with a running upstream provider", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        server: { host: "127.0.0.1", port: 0, maxSessions: 10 },
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
        telemetry: { serviceName: "test", otlpEndpoint: "" },
      }),
    );
    running = await main(configPath, { manageSignals: false });
    expect(running.registry.names()).toEqual(["stub"]);
    expect(running.gateway.address).toMatch(/^http:\/\//);
    const health = await fetch(`${running.gateway.address}/health`);
    expect(health.status).toBe(200);
  }, 30_000);

  test("throws on invalid config path", async () => {
    await expect(main(join(dir, "missing.json"))).rejects.toThrow();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});
