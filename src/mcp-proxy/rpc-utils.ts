import type { MCPRPCRequest, MCPRPCResponse } from '../types/types.ts'
import { MCP_PROXY_CONSTANTS } from './constants.ts'

export async function mcpRpcCall(
  rpcUrl: string,
  authToken: string,
  request: MCPRPCRequest,
): Promise<unknown> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    MCP_PROXY_CONSTANTS.RPC.REQUEST_TIMEOUT_MS,
  )

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const result: MCPRPCResponse = await response.json()

    if (result.error) {
      throw new Error(result.error)
    }

    return result.result
  } finally {
    clearTimeout(timeoutId)
  }
}
