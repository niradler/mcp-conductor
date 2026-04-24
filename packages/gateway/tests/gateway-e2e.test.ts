import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ConsoleAuditStore, ProviderRegistry } from "@mcp-conductor/core";
import { McpProvider } from "@mcp-conductor/provider-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startGateway, type StartGatewayResult } from "../src/server.js";
import { hashApiKey as ghash } from "../src/auth.js";

const here = dirname(fileURLToPath(import.meta.url));
const STUB = resolve(here, "../../provider-mcp/tests/fixtures/stub-mcp-server.ts");
const TSX = process.platform === "win32" ? "tsx.CMD" : "tsx";

describe("gateway e2e", () => {
  let gw: StartGatewayResult;
  let provider: McpProvider;
  let store: ConsoleAuditStore;

  beforeAll(async () => {
    provider = new McpProvider({
      name: "stub", transport: "stdio", command: TSX, args: [STUB],
      env: {}, initialListTimeoutMs: 10_000, callTimeoutMs: 10_000,
      reconnect: { maxAttempts: 1, initialDelayMs: 10, maxDelayMs: 20 },
    });
    await provider.connect();

    const registry = new ProviderRegistry();
    registry.register(provider);
    store = new ConsoleAuditStore({ writer: () => {} });

    gw = await startGateway({
      config: {
        server: { host: "127.0.0.1", port: 0, maxSessions: 10 },
        users: [{ name: "alice", apiKeyHash: ghash("alice-key"), groups: ["admin"] }],
        groups: [{ name: "admin", providers: ["*"] }],
      },
      registry,
      auditStore: store,
      manageSignals: false,
    });
  }, 30_000);

  afterAll(async () => {
    if (gw) await gw.close();
    if (provider) await provider.close();
  });

  test("client can list namespaced tools and call stub__echo", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${gw.address}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer alice-key" } },
    });
    const client = new Client({ name: "e2e", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["stub__echo", "stub__throw"]);

    const res = await client.callTool({ name: "stub__echo", arguments: { text: "hello" } });
    const content = res.content as Array<{ type: string; text?: string }>;
    expect(content[0]).toMatchObject({ type: "text", text: "hello" });
    await client.close();

    const rows = await store.queryCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user: "alice", provider: "stub", tool: "echo", status: "success" });
  }, 30_000);

  test("wrong API key returns 401", async () => {
    const res = await fetch(`${gw.address}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
  });
});
