import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const REQUEST_ID_HEADER = "X-Request-Id";

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const id = incoming && /^[A-Za-z0-9._~-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  c.set("requestId", id);
  c.header(REQUEST_ID_HEADER, id);
  await next();
};

export function getRequestIdFromRawHeaders(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers[REQUEST_ID_HEADER.toLowerCase()];
  const incoming = Array.isArray(raw) ? raw[0] : raw;
  return incoming && /^[A-Za-z0-9._~-]{1,128}$/.test(incoming) ? incoming : randomUUID();
}
