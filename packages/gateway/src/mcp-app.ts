import { Hono } from "hono";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, type ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthError, createLogger,
  type AuditStore, type ProviderRegistry, type ToolProvider, type Logger,
} from "@mcp-conductor/core";
import { extractBearer, verifyApiKey } from "./auth.js";
import { validateGatewayConfig, type GatewayConfig, type GatewayUser } from "./config.js";
import { providersForUser } from "./access-control.js";
import { encodeToolName, decodeToolName } from "./namespace.js";
import { auditedProvider } from "./audit-wrapper.js";
import { SessionManager } from "./session-manager.js";
import { getRequestIdFromRawHeaders, requestIdMiddleware } from "./request-id.js";

export interface ExportMcpAppDeps {
  config: GatewayConfig;
  registry: ProviderRegistry;
  auditStore: AuditStore;
  logger?: Logger;
}

export interface ExportedMcpApp {
  /** Attach to a Node `http.createServer`. Returns true if the request was handled. */
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** Hono app for `/health`, `/metrics`, and future admin routes. */
  honoApp: Hono;
  /** Close all live sessions; call from graceful shutdown. */
  closeSessions(): Promise<void>;
}

export function exportMcpApp(deps: ExportMcpAppDeps): ExportedMcpApp {
  const log = deps.logger ?? createLogger("gateway");
  validateGatewayConfig(deps.config, deps.registry.names());

  // Wrap every provider once with audit+tracing.
  const wrapped = new Map<string, ToolProvider>();
  for (const p of deps.registry.all()) wrapped.set(p.name, auditedProvider(p, { store: deps.auditStore }));

  const sessions = new SessionManager<McpServer, StreamableHTTPServerTransport>(
    deps.config.server.maxSessions,
    {
      async closeMcp(m) { try { await m.close(); } catch { /* ignore */ } },
      async closeTransport(t) { try { await t.close(); } catch { /* ignore */ } },
    },
    log,
  );

  async function buildMcpServer(user: GatewayUser, requestId: string): Promise<McpServer> {
    const allowed = providersForUser(deps.config, user, deps.registry.names());
    const server = new McpServer({ name: "mcp-conductor", version: "0.2.0" });

    for (const providerName of allowed) {
      const provider = wrapped.get(providerName);
      if (!provider) continue;
      const tools = await provider.listTools();
      for (const tool of tools) {
        const fullName = encodeToolName(providerName, tool.name);
        const shape = jsonSchemaToZodRawShape(tool.inputSchema);
        server.registerTool(
          fullName,
          {
            description: tool.description,
            inputSchema: shape,
          },
          async (args: unknown, extra: unknown) => {
            const decoded = decodeToolName(fullName);
            if (!decoded) throw new Error(`bad tool name: ${fullName}`);
            const inner = wrapped.get(decoded.provider);
            if (!inner) throw new Error(`provider vanished: ${decoded.provider}`);
            const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
            const result = await inner.callTool(decoded.tool, args, {
              user: user.name,
              requestId,
              signal,
            });
            return {
              content: result.content.map((c): ContentBlock => {
                if (c.type === "text") return { type: "text", text: c.text };
                if (c.type === "json") return { type: "text", text: JSON.stringify(c.json) };
                return c as unknown as ContentBlock;
              }),
              isError: result.isError,
            };
          },
        );
      }
    }
    return server;
  }

  /**
   * Convert an upstream JSON Schema into a Zod raw shape (`Record<string, ZodType>`).
   * We use `z.unknown()` per property so arguments pass through unvalidated —
   * the upstream MCP server is the source of truth for validation.
   */
  function jsonSchemaToZodRawShape(schema: Record<string, unknown>): Record<string, z.ZodType> {
    const shape: Record<string, z.ZodType> = {};
    const props = schema?.["properties"];
    if (props && typeof props === "object") {
      for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
        const prop = value as Record<string, unknown>;
        const desc = typeof prop?.["description"] === "string" ? prop["description"] : undefined;
        shape[key] = desc ? z.unknown().describe(desc) : z.unknown();
      }
    }
    return shape;
  }

  function authenticate(req: IncomingMessage): GatewayUser {
    const token = extractBearer(req.headers.authorization);
    if (!token) throw new AuthError("missing Bearer token");
    for (const u of deps.config.users) {
      if (verifyApiKey(token, u.apiKeyHash)) return u;
    }
    throw new AuthError("invalid API key");
  }

  async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url?.startsWith("/mcp")) return false;
    const requestId = getRequestIdFromRawHeaders(req.headers as Record<string, string | string[] | undefined>);
    res.setHeader("X-Request-Id", requestId);

    let user: GatewayUser;
    try { user = authenticate(req); }
    catch (err) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: (err as Error).message }));
      return true;
    }

    const existingId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
    const existing = existingId ? sessions.get(existingId) : undefined;

    if (existing) {
      await existing.transport.handleRequest(req, res);
      return true;
    }

    // No session → must be an initialize request. Parse body first so the
    // transport can see it and we can gate non-initialize traffic.
    const body = req.method === "POST" ? await readJsonBody(req) : undefined;
    if (req.method === "POST" && !isInitializeRequest(body)) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: Server not initialized" },
        id: null,
      }));
      return true;
    }

    const mcp = await buildMcpServer(user, requestId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.add({ id: sid, user: user.name, mcp, transport, createdAt: Date.now() })
          .catch((err) => log.warn("session add failed", { sid, err }));
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) sessions.remove(id).catch(() => {});
    };
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
    return true;
  }

  const honoApp = new Hono();
  honoApp.use("*", requestIdMiddleware);
  honoApp.get("/health", (c) => c.json({ ok: true, sessions: sessions.size(), providers: deps.registry.names() }));
  honoApp.notFound((c) => c.json({ error: "not found" }, 404));

  return {
    handleRequest,
    honoApp,
    closeSessions: () => sessions.closeAll(),
  };
}
