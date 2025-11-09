import { join } from 'jsr:@std/path@^1'

export function getHomeDir(): string {
  return Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || Deno.cwd()
}

export function getMcpConductorBaseDir(): string {
  const override = Deno.env.get('MCP_CONDUCTOR_BASE_DIR')
  if (override) {
    return override
  }
  return join(getHomeDir(), '.mcp-conductor')
}

export function getWorkspaceDir(): string {
  const override = Deno.env.get('MCP_CONDUCTOR_WORKSPACE')
  if (override) {
    return override
  }
  return join(getMcpConductorBaseDir(), 'workspace')
}

export function getConfigPath(): string {
  const override = Deno.env.get('MCP_CONDUCTOR_PROXY_CONFIG')
  if (override) {
    return override
  }
  return join(getMcpConductorBaseDir(), 'mcp.json')
}

export async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true })
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error
    }
  }
}
