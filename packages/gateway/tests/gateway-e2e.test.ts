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
        server: {
          host: "127.0.0.1",
          port: 0,
          maxSessions: 10,
          maxArgSizeBytes: 256,
          maxCallsPerMinute: 0,
        },
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
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "conductor__list_providers",
      "conductor__list_tools",
      "stub__echo",
      "stub__throw",
    ]);

    const res = await client.callTool({ name: "stub__echo", arguments: { text: "hello" } });
    const content = res.content as Array<{ type: string; text?: string }>;
    expect(content[0]).toMatchObject({ type: "text", text: "hello" });
    await client.close();

    const rows = await store.queryCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user: "alice", provider: "stub", tool: "echo", status: "success" });
  }, 30_000);

  test("conductor__list_providers returns name + description + toolCount", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${gw.address}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer alice-key" } },
    });
    const client = new Client({ name: "e2e", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport);

    const res = await client.callTool({ name: "conductor__list_providers", arguments: {} });
    const content = res.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.type).toBe("text");
    const summary = JSON.parse(content[0]!.text!) as Array<{
      name: string;
      description?: string;
      instructions?: string;
      toolCount: number;
    }>;
    expect(summary).toEqual([
      {
        name: "stub",
        description: "Stub MCP server used for tests.",
        instructions: "Call echo(text) to round-trip a string.",
        toolCount: 2,
      },
    ]);
    await client.close();
  }, 30_000);

  test("wrong API key returns 401 with structured body", async () => {
    const res = await fetch(`${gw.address}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("auth/unauthorized");
    expect(typeof body.error?.message).toBe("string");
  });

  test("unknown HTTP path returns 404 with structured body", async () => {
    const res = await fetch(`${gw.address}/no-such-path`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("not_found");
  });

  test("each tool call gets its own audit requestId", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${gw.address}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer alice-key" } },
    });
    const client = new Client({ name: "e2e-rid", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport);

    const before = (await store.queryCalls()).length;
    await client.callTool({ name: "stub__echo", arguments: { text: "one" } });
    await client.callTool({ name: "stub__echo", arguments: { text: "two" } });
    await client.close();

    const rows = await store.queryCalls();
    const added = rows.slice(before);
    expect(added).toHaveLength(2);
    const [a, b] = added;
    expect(a!.requestId).toBeTruthy();
    expect(b!.requestId).toBeTruthy();
    expect(a!.requestId).not.toBe(b!.requestId);
  }, 30_000);

  test("oversized request body returns 413 with structured body", async () => {
    // maxArgSizeBytes is set to 256 in the test config; 1KB of payload should trip it.
    const oversized = "x".repeat(1024);
    const res = await fetch(`${gw.address}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer alice-key", "Content-Type": "application/json" },
      body: JSON.stringify({ filler: oversized }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: { code?: string; details?: { limit?: number } } };
    expect(body.error?.code).toBe("request/too_large");
    expect(body.error?.details?.limit).toBe(256);
  });
});
