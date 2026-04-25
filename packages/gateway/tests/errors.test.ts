import { describe, test, expect } from "vitest";
import { ServerResponse } from "node:http";
import { Socket } from "node:net";
import { buildGatewayError, GatewayErrorCode, writeErrorResponse } from "../src/errors.js";

function makeRes(): ServerResponse {
  return new ServerResponse({ method: "GET" } as never);
}

function captureBody(res: ServerResponse): { status: number; headers: Record<string, string>; body: string } {
  // ServerResponse.write/end just enqueue onto the socket; we attach a fake socket and read what was queued.
  const chunks: Buffer[] = [];
  const socket = new Socket();
  socket.write = ((chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  }) as never;
  res.assignSocket(socket);
  return {
    get status() { return res.statusCode; },
    get headers() { return res.getHeaders() as Record<string, string>; },
    get body() {
      // Strip HTTP head; our payload is whatever follows the blank line.
      const raw = Buffer.concat(chunks).toString("utf8");
      const idx = raw.indexOf("\r\n\r\n");
      return idx === -1 ? raw : raw.slice(idx + 4);
    },
  };
}

describe("buildGatewayError", () => {
  test("returns standard shape without details", () => {
    expect(buildGatewayError(GatewayErrorCode.NotFound, "missing")).toEqual({
      error: { code: "not_found", message: "missing" },
    });
  });

  test("includes details when provided", () => {
    expect(buildGatewayError("custom/error", "bad", { hint: "x" })).toEqual({
      error: { code: "custom/error", message: "bad", details: { hint: "x" } },
    });
  });
});

describe("writeErrorResponse", () => {
  test("writes status, content type, and structured body", () => {
    const res = makeRes();
    const cap = captureBody(res);
    writeErrorResponse(res, 401, GatewayErrorCode.AuthUnauthorized, "missing Bearer token");
    expect(cap.status).toBe(401);
    expect(cap.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(cap.body)).toEqual({
      error: { code: "auth/unauthorized", message: "missing Bearer token" },
    });
  });

  test("is a no-op when response already ended", () => {
    const res = makeRes();
    const cap = captureBody(res);
    res.statusCode = 200;
    res.end("ok");
    writeErrorResponse(res, 500, GatewayErrorCode.InternalError, "boom");
    // The body is the original "ok" payload; status untouched.
    expect(cap.status).toBe(200);
    expect(cap.body).toBe("ok");
  });
});
