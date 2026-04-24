import { describe, test, expect } from "vitest";
import { Hono } from "hono";
import { requestIdMiddleware, REQUEST_ID_HEADER, getRequestIdFromRawHeaders } from "../src/request-id.js";

describe("requestIdMiddleware", () => {
  test("honors valid incoming id", async () => {
    const app = new Hono();
    app.use(requestIdMiddleware);
    app.get("/", (c) => c.text(c.get("requestId" as never) as string));
    const res = await app.request("/", { headers: { [REQUEST_ID_HEADER]: "abc-123" } });
    expect(await res.text()).toBe("abc-123");
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("abc-123");
  });

  test("generates a new id when absent", async () => {
    const app = new Hono();
    app.use(requestIdMiddleware);
    app.get("/", (c) => c.text(c.get("requestId" as never) as string));
    const res = await app.request("/");
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("rejects malformed incoming id and generates fresh", async () => {
    const app = new Hono();
    app.use(requestIdMiddleware);
    app.get("/", (c) => c.text(c.get("requestId" as never) as string));
    const res = await app.request("/", { headers: { [REQUEST_ID_HEADER]: "has spaces & !" } });
    expect(res.headers.get(REQUEST_ID_HEADER)).not.toContain(" ");
  });

  test("getRequestIdFromRawHeaders validates", () => {
    expect(getRequestIdFromRawHeaders({ "x-request-id": "good-1" })).toBe("good-1");
    const generated = getRequestIdFromRawHeaders({});
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });
});
