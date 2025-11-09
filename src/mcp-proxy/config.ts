import { isAbsolute, normalize } from 'jsr:@std/path@^1'
import { createHash } from 'node:crypto'
import type { MCPServerConfig } from '../types/types.ts'
import { getConfigPath as getDefaultConfigPath } from '../common/paths.ts'

function isPathSafe(path: string): boolean {
  const normalized = normalize(path)
  return isAbsolute(normalized) && !normalized.includes('..')
}

export async function getConfigPath(): Promise<string> {
  const configPath = getDefaultConfigPath()
  if (!isPathSafe(configPath)) {
    console.error('Invalid config path (path traversal detected), using default')
    return getDefaultConfigPath()
  }
  return configPath
}

export async function loadConfig(): Promise<MCPServerConfig | null> {
  const configPath = await getConfigPath()

  try {
    const content = await Deno.readTextFile(configPath)
    const config = JSON.parse(content) as MCPServerConfig

    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      console.error('Invalid MCP config: missing or invalid mcpServers object')
      return null
    }

    return config
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null
    }
    console.error(`Failed to load MCP config from ${configPath}:`, error)
    return null
  }
}

export async function calculateConfigHash(): Promise<string | null> {
  const configPath = await getConfigPath()

  try {
    const content = await Deno.readTextFile(configPath)
    const hash = createHash('sha256')
    hash.update(content)
    return hash.digest('hex')
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null
    }
    console.error(`Failed to calculate config hash:`, error)
    return null
  }
}

export function validateConfig(config: MCPServerConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    errors.push('Missing or invalid mcpServers object')
    return { valid: false, errors }
  }

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    const hasCommand = 'command' in serverConfig
    const hasUrl = 'url' in serverConfig

    if (!hasCommand && !hasUrl) {
      errors.push(`Server "${name}": must have either command or url`)
    }

    if (hasCommand && hasUrl) {
      errors.push(`Server "${name}": cannot have both command and url`)
    }

    if (hasCommand && !serverConfig.args) {
      errors.push(`Server "${name}": command requires args array`)
    }

    if (hasUrl && !('transport' in serverConfig)) {
      ;(serverConfig as any).transport = 'sse'
    }
  }

  return { valid: errors.length === 0, errors }
}
