import { z } from 'npm:zod@^3.23.8'
import type { MCPManager } from './manager.ts'
import type { MCPServerInfo, MCPToolDetails } from '../types/types.ts'

export function createMCPProxyTools(manager: MCPManager) {
  return {
    list_mcp_servers: {
      tool: {
        title: 'List MCP Servers',
        description: 'List all available MCP servers with their tools, resources, and prompts. Use this to discover what MCP servers are available.',
        inputSchema: {}
      },
      handler: async (): Promise<{ servers: MCPServerInfo[] }> => {
        await manager.reloadIfNeeded()
        const servers = manager.listServers()
        return { servers }
      }
    },

    get_tool_details: {
      tool: {
        title: 'Get Tool Details',
        description: 'Get detailed information about specific tools from an MCP server, including full schemas and descriptions.',
        inputSchema: {
          server: z.string().describe('MCP server name (from list_mcp_servers)'),
          tools: z.array(z.string()).optional().describe(
            'Optional array of specific tool names to get details for. If omitted, returns all tools from the server.'
          )
        }
      },
      handler: async ({ server, tools }: { server: string; tools?: string[] }): Promise<{ tools: MCPToolDetails[] }> => {
        await manager.reloadIfNeeded()
        const toolDetails = manager.getToolDetails(server, tools)
        return { tools: toolDetails }
      }
    }
  }
}

