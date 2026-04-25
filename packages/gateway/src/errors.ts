import type { ServerResponse } from "node:http";

/**
 * Stable error code strings emitted in HTTP error responses.
 * Clients can branch on these without parsing message text.
 *
 * Codes use a `category/specific` shape so we can group them later
 * (e.g. all `auth/*` are authentication failures).
 */
export const GatewayErrorCode = {
  AuthUnauthorized: "auth/unauthorized",
  NotFound: "not_found",
  BadRequest: "bad_request",
  InternalError: "internal_error",
  RequestTooLarge: "request/too_large",
  RateLimited: "rate_limited",
} as const;

export type GatewayErrorCodeValue = (typeof GatewayErrorCode)[keyof typeof GatewayErrorCode];

export interface GatewayErrorBody {
  error: {
    code: GatewayErrorCodeValue | string;
    message: string;
    details?: unknown;
  };
}

/** Build a structured error body without writing to a response. */
export function buildGatewayError(
  code: GatewayErrorCodeValue | string,
  message: string,
  details?: unknown,
): GatewayErrorBody {
  const body: GatewayErrorBody = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return body;
}

/** Write a structured JSON error response. Idempotent: skips writing if response already ended. */
export function writeErrorResponse(
  res: ServerResponse,
  status: number,
  code: GatewayErrorCodeValue | string,
  message: string,
  details?: unknown,
): void {
  if (res.writableEnded) return;
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
  }
  res.end(JSON.stringify(buildGatewayError(code, message, details)));
}
