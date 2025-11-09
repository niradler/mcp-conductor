export class MCPProxyError extends Error {
  public readonly code: string
  public override readonly cause?: Error

  constructor(
    message: string,
    code: string,
    cause?: Error,
  ) {
    super(message)
    this.name = 'MCPProxyError'
    this.code = code
    this.cause = cause
  }
}

export function validateServerExists(
  entry: { error: string | null } | undefined,
  serverName: string,
): asserts entry is { error: string | null } {
  if (!entry) {
    throw new MCPProxyError(
      `MCP server "${serverName}" not found`,
      'SERVER_NOT_FOUND',
    )
  }
  if (entry.error) {
    throw new MCPProxyError(
      `MCP server "${serverName}" failed to connect: ${entry.error}`,
      'SERVER_CONNECT_FAILED',
    )
  }
}

export function validateRPCArgs(args: unknown[], expectedLength: number, method: string): void {
  if (!Array.isArray(args)) {
    throw new MCPProxyError(
      `Invalid args for ${method}: expected array`,
      'INVALID_ARGS',
    )
  }
  if (args.length < expectedLength) {
    throw new MCPProxyError(
      `Invalid args for ${method}: expected at least ${expectedLength}, got ${args.length}`,
      'INVALID_ARGS_LENGTH',
    )
  }
}
