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
import { GatewayErrorCode, buildGatewayError, writeErrorResponse } from "./errors.js";
import { RateLimiter } from "./rate-limit.js";

export interface ExportMcpAppDeps {
  config: GatewayConfig;
  registry: ProviderRegistry;
  auditStore: AuditStore;
  logger?: Logger;
  /** Optional per-provider audit redaction. Returns extra arg keys to replace with [REDACTED]. */
  redactKeysForProvider?: (providerName: string) => string[];
}

export interface ExportedMcpApp {
  /** Attach to a Node `http.createServer`. Returns true if the request was handled. */
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** Hono app for `/health`, `/metrics`, and future admin routes. */
  honoApp: Hono;
  /** Close all live sessions; call from graceful shutdown. */
  closeSessions(): Promise<void>;
}

export function jsonSchemaToZodRawShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const props = schema["properties"];
  const required = Array.isArray(schema["required"]) ? (schema["required"] as string[]) : [];

  if (props && typeof props === "object" && !Array.isArray(props)) {
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      let zodType = jsonSchemaPropertyToZod(value as Record<string, unknown>);
      if (!required.includes(key)) zodType = zodType.optional();
      shape[key] = zodType;
    }
  }
  return shape;
}

function jsonSchemaPropertyToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const description = typeof schema["description"] === "string" ? schema["description"] : undefined;
  let zodType: z.ZodTypeAny;

  if (Array.isArray(schema["enum"])) {
    zodType = buildEnumZod(schema["enum"] as unknown[]);
  } else {
    const anyOf = (schema["anyOf"] ?? schema["oneOf"]) as Record<string, unknown>[] | undefined;
    if (Array.isArray(anyOf)) {
      zodType = buildUnionZod(anyOf);
    } else {
      const rawType = schema["type"];
      const typeArr: string[] = Array.isArray(rawType) ? (rawType as string[]) : rawType ? [rawType as string] : [];

      if (typeArr.length === 2 && typeArr.includes("null")) {
        const nonNull = typeArr.find((t) => t !== "null")!;
        zodType = jsonSchemaPropertyToZod({ ...schema, type: nonNull, description: undefined }).nullable();
      } else {
        zodType = buildPrimitiveZod(schema, typeArr[0]);
      }
    }
  }

  return description ? zodType.describe(description) : zodType;
}

function buildPrimitiveZod(schema: Record<string, unknown>, type: string | undefined): z.ZodTypeAny {
  if (type === "string") {
    let s = z.string();
    if (typeof schema["minLength"] === "number") s = s.min(schema["minLength"]);
    if (typeof schema["maxLength"] === "number") s = s.max(schema["maxLength"]);
    if (typeof schema["pattern"] === "string") s = s.regex(new RegExp(schema["pattern"]));
    return s;
  }
  if (type === "number" || type === "integer") {
    let n = z.number();
    if (type === "integer") n = n.int();
    if (typeof schema["minimum"] === "number") n = n.min(schema["minimum"]);
    if (typeof schema["maximum"] === "number") n = n.max(schema["maximum"]);
    if (typeof schema["exclusiveMinimum"] === "number") n = n.gt(schema["exclusiveMinimum"]);
    if (typeof schema["exclusiveMaximum"] === "number") n = n.lt(schema["exclusiveMaximum"]);
    return n;
  }
  if (type === "boolean") return z.boolean();
  if (type === "null") return z.null();
  if (type === "array") {
    const items = schema["items"];
    const itemZod =
      items && typeof items === "object" && !Array.isArray(items)
        ? jsonSchemaPropertyToZod(items as Record<string, unknown>)
        : z.unknown();
    let arr = z.array(itemZod);
    if (typeof schema["minItems"] === "number") arr = arr.min(schema["minItems"]);
    if (typeof schema["maxItems"] === "number") arr = arr.max(schema["maxItems"]);
    return arr;
  }
  if (type === "object") {
    const shape = jsonSchemaToZodRawShape(schema);
    return Object.keys(shape).length > 0 ? z.object(shape).passthrough() : z.record(z.unknown());
  }
  return z.unknown();
}

function buildEnumZod(values: unknown[]): z.ZodTypeAny {
  if (values.length === 0) return z.never();
  if (values.length === 1) return z.literal(values[0] as string | number | boolean | null);
  if (values.every((v) => typeof v === "string")) return z.enum(values as [string, ...string[]]);
  const [first, second, ...rest] = values.map((v) => z.literal(v as string | number | boolean | null));
  return z.union([first!, second!, ...rest] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function buildUnionZod(variants: Record<string, unknown>[]): z.ZodTypeAny {
  if (variants.length === 0) return z.unknown();
  if (variants.length === 1) return jsonSchemaPropertyToZod(variants[0]!);
  const [first, second, ...rest] = variants.map((v) => jsonSchemaPropertyToZod(v));
  return z.union([first!, second!, ...rest] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

export function exportMcpApp(deps: ExportMcpAppDeps): ExportedMcpApp {
  const log = deps.logger ?? createLogger("gateway");
  validateGatewayConfig(deps.config, deps.registry.names());

  // Wrap every provider once with audit+tracing.
  const wrapped = new Map<string, ToolProvider>();
  for (const p of deps.registry.all()) {
    const redactExtraKeys = deps.redactKeysForProvider?.(p.name);
    wrapped.set(
      p.name,
      auditedProvider(p, {
        store: deps.auditStore,
        ...(redactExtraKeys && redactExtraKeys.length > 0 ? { redactExtraKeys } : {}),
      }),
    );
  }

  const sessions = new SessionManager<McpServer, StreamableHTTPServerTransport>(
    deps.config.server.maxSessions,
    {
      async closeMcp(m) { try { await m.close(); } catch { /* ignore */ } },
      async closeTransport(t) { try { await t.close(); } catch { /* ignore */ } },
    },
    log,
  );

  const maxArgSizeBytes = deps.config.server.maxArgSizeBytes;
  const rateLimiter = new RateLimiter(deps.config.server.maxCallsPerMinute);

  async function buildMcpServer(user: GatewayUser, requestId: string): Promise<McpServer> {
    const allowed = [...providersForUser(deps.config, user, deps.registry.names())];
    const server = new McpServer({ name: "conductor", version: "0.2.0" });

    // Pre-fetch all tool listings once; used for both provider tools and meta-tools.
    const providerTools = new Map<string, Awaited<ReturnType<ToolProvider["listTools"]>>>();
    for (const providerName of allowed) {
      const provider = wrapped.get(providerName);
      if (!provider) continue;
      providerTools.set(providerName, await provider.listTools());
    }

    // Meta-tools: built-in gateway tools for agent-side provider discovery.
    server.registerTool(
      "conductor__list_providers",
      {
        description: "List all MCP provider names accessible to the current user.",
        inputSchema: {},
      },
      async () => ({ content: [{ type: "text" as const, text: JSON.stringify(allowed) }] }),
    );

    server.registerTool(
      "conductor__list_tools",
      {
        description:
          "List all tools exposed by a specific MCP provider, including their names, descriptions, and input schemas.",
        inputSchema: {
          provider: z.string().describe("Provider name (use conductor__list_providers to discover names)"),
        },
      },
      async ({ provider }) => {
        const tools = providerTools.get(provider);
        if (!tools) {
          return {
            content: [{ type: "text" as const, text: `Unknown provider: "${provider}". Available: ${allowed.join(", ")}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(tools) }] };
      },
    );

    // Register provider tools under namespaced names.
    for (const [providerName, tools] of providerTools) {
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

    // Reject oversized payloads before authenticating — keeps DoS payloads cheap.
    const declaredLength = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxArgSizeBytes) {
      writeErrorResponse(
        res,
        413,
        GatewayErrorCode.RequestTooLarge,
        `request body exceeds limit of ${maxArgSizeBytes} bytes`,
        { limit: maxArgSizeBytes, received: declaredLength },
      );
      return true;
    }

    let user: GatewayUser;
    try { user = authenticate(req); }
    catch (err) {
      writeErrorResponse(res, 401, GatewayErrorCode.AuthUnauthorized, (err as Error).message);
      return true;
    }

    const existingId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
    const existing = existingId ? sessions.get(existingId) : undefined;

    if (existing) {
      if (!rateLimiter.tryConsume(existing.id)) {
        writeErrorResponse(
          res,
          429,
          GatewayErrorCode.RateLimited,
          `session exceeded ${rateLimiter.maxPerMinute} requests/minute`,
          { limit: rateLimiter.maxPerMinute },
        );
        return true;
      }
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
      if (id) {
        rateLimiter.forget(id);
        sessions.remove(id).catch(() => {});
      }
    };
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
    return true;
  }

  const honoApp = new Hono();
  honoApp.use("*", requestIdMiddleware);
  honoApp.get("/health", (c) => c.json({ ok: true, sessions: sessions.size(), providers: deps.registry.names() }));
  honoApp.notFound((c) => c.json(buildGatewayError(GatewayErrorCode.NotFound, "not found"), 404));

  return {
    handleRequest,
    honoApp,
    closeSessions: () => sessions.closeAll(),
  };
}
