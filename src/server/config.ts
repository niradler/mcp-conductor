/**
 * Server configuration from environment variables
 *
 * Supported environment variables:
 * - MCP_CONDUCTOR_WORKSPACE: Workspace directory path
 * - MCP_CONDUCTOR_ALLOWED_PACKAGES: Comma-separated list of allowed packages
 * - MCP_CONDUCTOR_RUN_ARGS: Comma-separated Deno permission flags
 * - MCP_CONDUCTOR_DEFAULT_TIMEOUT: Default execution timeout in ms
 * - MCP_CONDUCTOR_MAX_TIMEOUT: Maximum execution timeout in ms
 */

import type { ServerConfig } from '../types/types.ts'
import { DEFAULT_ALLOWED_DEPENDENCIES } from '../executor/allowlist.ts'

/**
 * Parse allowed packages from environment variable
 * Format: "npm:axios@^1,npm:zod@^3,jsr:@std/path"
 */
function parseAllowedPackages(value?: string): string[] | true {
  if (!value || value.trim() === '') {
    return DEFAULT_ALLOWED_DEPENDENCIES
  }

  // Special value to allow all
  if (value.toLowerCase() === 'all' || value === '*') {
    return true
  }

  // Parse comma-separated list
  return value.split(',').map((pkg) => pkg.trim()).filter((pkg) => pkg.length > 0)
}

/**
 * Parse Deno run arguments from environment variable
 * Format: "no-prompt,allow-read,allow-write=/tmp"
 *
 * These are DEFAULT flags used when no permissions are specified in tool call
 * User-specified permissions will OVERRIDE these defaults
 */
function parseRunArgs(value?: string): string[] {
  if (!value || value.trim() === '') {
    return []
  }

  return value
    .split(',')
    .map((arg) => {
      arg = arg.trim()
      // Add -- prefix if not present
      if (!arg.startsWith('-')) {
        return `--${arg}`
      }
      return arg
    })
    .filter((arg) => arg.length > 2) // Filter out just "--"
}

/**
 * Parse timeout value from environment variable
 */
function parseTimeout(value?: string, defaultValue?: number): number | undefined {
  if (!value || value.trim() === '') {
    return defaultValue
  }

  const parsed = parseInt(value, 10)
  if (isNaN(parsed) || parsed <= 0) {
    console.error(`Invalid timeout value: ${value}, using default`)
    return defaultValue
  }

  return parsed
}

/**
 * Load server configuration from environment variables
 */
export function loadConfigFromEnv(): ServerConfig {
  const workspaceDir = Deno.env.get('MCP_CONDUCTOR_WORKSPACE')
  const allowedPackages = parseAllowedPackages(Deno.env.get('MCP_CONDUCTOR_ALLOWED_PACKAGES'))
  const runArgs = parseRunArgs(Deno.env.get('MCP_CONDUCTOR_RUN_ARGS'))
  const defaultTimeout = parseTimeout(Deno.env.get('MCP_CONDUCTOR_DEFAULT_TIMEOUT'))
  const maxTimeout = parseTimeout(Deno.env.get('MCP_CONDUCTOR_MAX_TIMEOUT'))

  // Log configuration
  console.error('=== MCP Conductor Configuration ===')

  if (workspaceDir) {
    console.error(`Workspace: ${workspaceDir}`)
  } else {
    console.error('Workspace: (default)')
  }

  if (Array.isArray(allowedPackages)) {
    console.error(`Allowed packages: ${allowedPackages.length} packages`)
    if (allowedPackages.length <= 10) {
      allowedPackages.forEach((pkg) => console.error(`  - ${pkg}`))
    } else {
      allowedPackages.slice(0, 5).forEach((pkg) => console.error(`  - ${pkg}`))
      console.error(`  ... and ${allowedPackages.length - 5} more`)
    }
  } else {
    console.error('⚠️  Allowed packages: ALL (unrestricted)')
  }

  if (runArgs.length > 0) {
    console.error(`Additional run args: ${runArgs.join(' ')}`)
  }

  if (defaultTimeout) {
    console.error(`Default timeout: ${defaultTimeout}ms`)
  }

  if (maxTimeout) {
    console.error(`Max timeout: ${maxTimeout}ms`)
  }

  console.error('===================================')

  return {
    workspaceDir,
    allowedDependencies: allowedPackages,
    defaultRunArgs: runArgs,
    defaultTimeout,
    maxTimeout,
  }
}

/**
 * Example configurations for documentation
 */
export const EXAMPLE_CONFIGS = {
  // Minimal - only allow specific packages
  minimal: {
    MCP_CONDUCTOR_ALLOWED_PACKAGES: 'npm:axios@^1,jsr:@std/path',
    MCP_CONDUCTOR_RUN_ARGS: 'no-prompt',
  },

  // Development - more permissive
  development: {
    MCP_CONDUCTOR_WORKSPACE: '/tmp/mcp-sessions',
    MCP_CONDUCTOR_ALLOWED_PACKAGES: 'all',
    MCP_CONDUCTOR_RUN_ARGS: 'no-prompt,allow-read=/tmp/mcp-sessions,allow-write=/tmp/mcp-sessions',
  },

  // Production - strict security
  production: {
    MCP_CONDUCTOR_WORKSPACE: '${HOME}/.mcp-conductor/sessions',
    MCP_CONDUCTOR_ALLOWED_PACKAGES: 'npm:axios@^1,npm:zod@^3,jsr:@std/path,jsr:@std/fs',
    MCP_CONDUCTOR_RUN_ARGS: 'no-prompt',
    MCP_CONDUCTOR_DEFAULT_TIMEOUT: '10000',
    MCP_CONDUCTOR_MAX_TIMEOUT: '30000',
  },

  // AI Agent - balanced for LLM workflows
  agent: {
    MCP_CONDUCTOR_WORKSPACE: '${HOME}/.mcp-conductor/sessions',
    MCP_CONDUCTOR_ALLOWED_PACKAGES:
      'npm:axios@^1,npm:zod@^3,npm:lodash@^4,npm:date-fns@^3,jsr:@std/path,jsr:@std/fs,jsr:@std/collections,jsr:@std/async',
    MCP_CONDUCTOR_RUN_ARGS:
      'no-prompt,allow-read=${HOME}/.mcp-conductor/sessions,allow-write=${HOME}/.mcp-conductor/sessions',
    MCP_CONDUCTOR_DEFAULT_TIMEOUT: '30000',
    MCP_CONDUCTOR_MAX_TIMEOUT: '60000',
  },
}
