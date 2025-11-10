import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { MCPServerConfig, MCPServerInfo, MCPToolDetails } from '../types/types.ts'
import { calculateConfigHash, loadConfig, validateConfig } from './config.ts'
import { validateServerExists } from './errors.ts'
import { MCP_PROXY_CONSTANTS } from './constants.ts'

interface MCPClientEntry {
  client: Client | null
  tools: Tool[]
  resources: Array<{ uri: string; name: string; description?: string }>
  prompts: Array<
    {
      name: string
      description?: string
      arguments?: Array<{ name: string; description?: string; required?: boolean }>
    }
  >
  description: string
  error: string | null
}

export class MCPManager {
  private clients: Map<string, MCPClientEntry> = new Map()
  private configHash: string | null = null
  private config: MCPServerConfig | null = null

  private validateEntry(serverName: string): MCPClientEntry {
    const entry = this.clients.get(serverName)
    validateServerExists(entry, serverName)
    return entry
  }

  private getClientSafe(serverName: string): Client {
    const entry = this.validateEntry(serverName)
    if (!entry.client) {
      throw new Error(`MCP server "${serverName}" client not available`)
    }
    return entry.client
  }

  async initialize(): Promise<void> {
    this.config = await loadConfig()

    if (!this.config) {
      console.error('No MCP proxy config found, MCP proxy features disabled')
      return
    }

    const validation = validateConfig(this.config)
    if (!validation.valid) {
      console.error('Invalid MCP config:')
      validation.errors.forEach((err) => console.error(`  - ${err}`))
      return
    }

    this.configHash = await calculateConfigHash()

    const serverNames = Object.keys(this.config.mcpServers).filter(
      (name) => !this.config!.mcpServers[name].disabled,
    )

    console.error(`Initializing ${serverNames.length} MCP server(s)...`)

    await Promise.all(
      serverNames.map((name) => this.initializeClient(name, this.config!.mcpServers[name])),
    )

    const successCount = Array.from(this.clients.values()).filter((e) => e.client !== null).length
    console.error(`MCP servers initialized: ${successCount}/${serverNames.length} successful`)
  }

  private async initializeClient(
    name: string,
    config: MCPServerConfig['mcpServers'][string],
  ): Promise<void> {
    const entry: MCPClientEntry = {
      client: null,
      tools: [],
      resources: [],
      prompts: [],
      description: '',
      error: null,
    }

    try {
      const client = new Client({
        name: 'mcp-conductor-proxy',
        version: MCP_PROXY_CONSTANTS.MANAGER.CLIENT_VERSION,
      }, {
        capabilities: {},
      })

      let transport: StdioClientTransport | SSEClientTransport

      if ('command' in config && config.command) {
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: config.env,
        })
      } else if ('url' in config && config.url) {
        transport = new SSEClientTransport(new URL(config.url))
      } else {
        throw new Error('No command or url specified')
      }

      await client.connect(transport)

      const serverInfo = client.getServerVersion()
      entry.description = serverInfo?.name || name

      const toolsResult = await client.listTools()
      entry.tools = toolsResult.tools || []

      try {
        const resourcesResult = await client.listResources()
        entry.resources = resourcesResult.resources || []
      } catch {
        entry.resources = []
      }

      try {
        const promptsResult = await client.listPrompts()
        entry.prompts = promptsResult.prompts || []
      } catch {
        entry.prompts = []
      }

      entry.client = client

      console.error(
        `✓ MCP server "${name}" connected: ${entry.tools.length} tools, ${entry.resources.length} resources, ${entry.prompts.length} prompts`,
      )
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error)
      console.error(`✗ MCP server "${name}" failed: ${entry.error}`)
    }

    this.clients.set(name, entry)
  }

  async reloadIfNeeded(): Promise<boolean> {
    const currentHash = await calculateConfigHash()

    if (currentHash === this.configHash) {
      return false
    }

    console.error('MCP config changed, reloading...')

    await this.disconnectAll()
    this.clients.clear()

    await this.initialize()

    return true
  }

  private async disconnectAll(): Promise<void> {
    const disconnectPromises: Promise<void>[] = []

    for (const entry of this.clients.values()) {
      if (entry.client) {
        disconnectPromises.push(
          entry.client.close().catch((err) => {
            console.error('Error disconnecting client:', err)
          }),
        )
      }
    }

    await Promise.all(disconnectPromises)
  }

  getClient(name: string): Client | null {
    const entry = this.clients.get(name)
    return entry?.client || null
  }

  listServers(): MCPServerInfo[] {
    const servers: MCPServerInfo[] = []

    for (const [name, entry] of this.clients.entries()) {
      const sampleTools = entry.tools.slice(0, MCP_PROXY_CONSTANTS.MANAGER.MAX_SAMPLE_TOOLS).map(
        (tool) => {
          const params = this.formatToolParams(tool)
          const description = tool.description || 'No description'
          return `${tool.name}(${params}) - ${description}`
        },
      )

      servers.push({
        name,
        description: entry.description || name,
        tools: entry.tools.length,
        resources: entry.resources.length,
        prompts: entry.prompts.length,
        sample_tools: sampleTools,
        error: entry.error,
      })
    }

    return servers
  }

  private formatToolParams(tool: Tool): string {
    if (!tool.inputSchema?.properties || typeof tool.inputSchema.properties !== 'object') {
      return ''
    }

    return Object.entries(tool.inputSchema.properties)
      .map(([key, schema]) => {
        const type = (schema as { type?: string }).type || 'any'
        const required = tool.inputSchema?.required?.includes(key) ? '' : '?'
        return `${key}${required}:${type}`
      })
      .join(', ')
  }

  getToolDetails(serverName: string, toolNames?: string[]): MCPToolDetails[] {
    const entry = this.validateEntry(serverName)
    let tools = entry.tools

    if (toolNames && toolNames.length > 0) {
      tools = tools.filter((t) => toolNames.includes(t.name))
    }

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || { type: 'object' },
    }))
  }

  async callTool(serverName: string, toolName: string, args: unknown): Promise<unknown> {
    const client = this.getClientSafe(serverName)
    return await client.callTool({
      name: toolName,
      arguments: args as Record<string, unknown>,
    })
  }

  listTools(serverName: string): Promise<Tool[]> {
    return Promise.resolve(this.validateEntry(serverName).tools)
  }

  listResources(
    serverName: string,
  ): Promise<Array<{ uri: string; name: string; description?: string }>> {
    return Promise.resolve(this.validateEntry(serverName).resources)
  }

  async readResource(serverName: string, uri: string): Promise<unknown> {
    const client = this.getClientSafe(serverName)
    return await client.readResource({ uri })
  }

  listPrompts(serverName: string): Promise<Array<{ name: string; description?: string }>> {
    return Promise.resolve(this.validateEntry(serverName).prompts)
  }

  async getPrompt(serverName: string, promptName: string, args: unknown): Promise<unknown> {
    const client = this.getClientSafe(serverName)
    return await client.getPrompt({
      name: promptName,
      arguments: args as Record<string, string>,
    })
  }

  async shutdown(): Promise<void> {
    console.error('Shutting down MCP proxy...')
    await this.disconnectAll()
    this.clients.clear()
  }
}
