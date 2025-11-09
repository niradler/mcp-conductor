import { assertEquals, assertExists } from 'jsr:@std/assert@^1'
import { MCPManager } from '../src/mcp-proxy/manager.ts'
import { generateMcpFactoryCode } from '../src/mcp-proxy/factory.ts'
import { MCPRPCServer } from '../src/mcp-proxy/rpc-server.ts'

Deno.test({
  name: 'MCP Proxy - MCPManager initialization',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const manager = new MCPManager()
    await manager.initialize()

    const servers = manager.listServers()
    assertExists(servers)
    assertEquals(Array.isArray(servers), true)

    await manager.shutdown()
    await new Promise((resolve) => setTimeout(resolve, 100))
  },
})

Deno.test('MCP Proxy - generateMcpFactoryCode', () => {
  const code = generateMcpFactoryCode(12345, 'test-token-123')

  assertExists(code)
  assertEquals(code.includes('mcpFactory'), true)
  assertEquals(code.includes('http://localhost:12345'), true)
  assertEquals(code.includes('test-token-123'), true)
  assertEquals(code.includes('async load(serverName)'), true)
  assertEquals(code.includes('callTool'), true)
  assertEquals(code.includes('listTools'), true)
  assertEquals(code.includes('Authorization'), true)
})

Deno.test({
  name: 'MCP Proxy - MCPRPCServer creation',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const manager = new MCPManager()
    await manager.initialize()

    const rpcServer = new MCPRPCServer(manager)
    assertExists(rpcServer)

    const port = await rpcServer.start()
    assertEquals(typeof port, 'number')
    assertEquals(port > 0, true)

    const response = await fetch(`http://localhost:${port}/health`)
    assertEquals(response.status, 200)
    assertEquals(await response.text(), 'OK')

    await rpcServer.stop()
    await manager.shutdown()
    await new Promise((resolve) => setTimeout(resolve, 100))
  },
})

Deno.test({
  name: 'MCP Proxy - Manager handles missing config gracefully',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const manager = new MCPManager()
    await manager.initialize()

    const servers = manager.listServers()
    assertEquals(Array.isArray(servers), true)

    await manager.shutdown()
    await new Promise((resolve) => setTimeout(resolve, 100))
  },
})
