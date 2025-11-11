/**
 * Server configuration from environment variables
 *
 * Supported environment variables:
 * - MCP_CONDUCTOR_WORKSPACE: Workspace directory path
 * - MCP_CONDUCTOR_RUN_ARGS: Comma-separated Deno permission flags
 * - MCP_CONDUCTOR_DEFAULT_TIMEOUT: Default execution timeout in ms
 * - MCP_CONDUCTOR_MAX_TIMEOUT: Maximum execution timeout in ms
 * - MCP_CONDUCTOR_MAX_RETURN_SIZE: Max return value size in bytes (default 256KB)
 */

/**
 * SECURITY MODEL
 *
 * Default Security Posture (based on Deno security model):
 * - Zero permissions (--allow-none) - Most secure by default
 * - --no-prompt: Prevents interactive permission escalation
 * - --cached-only: Only use cached dependencies (no network fetching)
 * - --no-remote: Block remote module fetching
 *
 * Two-Process Isolation:
 * Server process (trusted) runs with full permissions to manage workspace
 * User code subprocess (untrusted) runs with zero permissions by default
 * Subprocess crashes or OOM do not affect server
 * Each execution runs in fresh subprocess with clean environment
 *
 * Code Execution is Unrestricted (Deno Design):
 * Per https://docs.deno.com/runtime/fundamentals/security/
 * "No limits on the execution of code at the same privilege level"
 * - eval() and Function() - Allowed by design
 * - data: URLs - Allowed by design
 * - dynamic imports - Allowed by design
 * - WebAssembly - Allowed by design
 * - Workers - Allowed by design
 *
 * The Security Boundary is the PERMISSION SANDBOX:
 * All code executes at zero permissions by default - cannot access:
 * - File system (blocked by missing --allow-read/write)
 * - Network (blocked by missing --allow-net)
 * - Environment variables (blocked by missing --allow-env)
 * - Subprocesses (blocked by missing --allow-run)
 *
 * This aligns with Deno's security model where the permission system
 * is the defense, not restricting code execution mechanisms.
 */

import type { ServerConfig } from '../types/types.ts'

const DEFAULT_ROOT_DIR = (Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '.') +
  (Deno.build.os === 'windows' ? '\\' : '/') +
  '.mcp-conductor' +
  (Deno.build.os === 'windows' ? '\\' : '/')

const DEFAULT_WORKSPACE = DEFAULT_ROOT_DIR +
  'workspace'

export const SECURE_DEFAULTS = {
  workspace: DEFAULT_WORKSPACE,
  runArgs: ['--cached-only', '--no-remote'],
  defaultTimeout: 30000,
  maxTimeout: 300000,
  maxReturnSize: 262144,
}

function parseRunArgs(value?: string, rootDir?: string): string[] {
  const root = rootDir || DEFAULT_ROOT_DIR

  if (!value || value.trim() === '') {
    return [
      ...SECURE_DEFAULTS.runArgs,
      `--allow-read=${root}`,
      `--allow-write=${root}workspace`,
      '--allow-net=localhost',
    ]
  }

  const userArgs = value
    .split(';')
    .map((arg) => {
      arg = arg.trim()
      if (!arg.startsWith('-')) {
        return `--${arg}`
      }
      return arg
    })
    .filter((arg) => arg.length > 2)

  const hasNetPermission = userArgs.some((arg) => arg.startsWith('--allow-net'))

  if (hasNetPermission) {
    return userArgs
  }

  return [...userArgs, ...SECURE_DEFAULTS.runArgs]
}

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

export function loadConfigFromEnv(): ServerConfig {
  const workspaceDir = Deno.env.get('MCP_CONDUCTOR_WORKSPACE') || SECURE_DEFAULTS.workspace
  const rootDir = workspaceDir.replace(/[\/\\]workspace[\/\\]?$/, '') || DEFAULT_ROOT_DIR
  const runArgs = parseRunArgs(Deno.env.get('MCP_CONDUCTOR_RUN_ARGS'), rootDir)
  const defaultTimeout = parseTimeout(
    Deno.env.get('MCP_CONDUCTOR_DEFAULT_TIMEOUT'),
    SECURE_DEFAULTS.defaultTimeout,
  )
  const maxTimeout = parseTimeout(
    Deno.env.get('MCP_CONDUCTOR_MAX_TIMEOUT'),
    SECURE_DEFAULTS.maxTimeout,
  )
  const maxReturnSize = parseTimeout(
    Deno.env.get('MCP_CONDUCTOR_MAX_RETURN_SIZE'),
    SECURE_DEFAULTS.maxReturnSize,
  )

  console.error('=== MCP Conductor Configuration ===')
  console.error(`Root dir: ${rootDir}`)
  console.error(`Workspace: ${workspaceDir}`)
  console.error(`Run args: ${runArgs.join(' ')}`)
  console.error(`Default timeout: ${defaultTimeout}ms`)
  console.error(`Max timeout: ${maxTimeout}ms`)
  console.error(`Max return size: ${maxReturnSize} bytes`)
  console.error('===================================')

  return {
    workspaceDir,
    defaultRunArgs: runArgs,
    defaultTimeout,
    maxTimeout,
    maxReturnSize,
  }
}

/**
 * Example configurations for documentation
 */
export const EXAMPLE_CONFIGS = {
  secure: {
    MCP_CONDUCTOR_WORKSPACE: '${HOME}/.mcp-conductor/workspace',
    MCP_CONDUCTOR_RUN_ARGS:
      'allow-read=${HOME}/.mcp-conductor;allow-write=${HOME}/.mcp-conductor/workspace',
  },

  development: {
    MCP_CONDUCTOR_WORKSPACE: '/tmp/mcp-workspace',
    MCP_CONDUCTOR_RUN_ARGS: 'allow-read=/tmp,/usr;allow-write=/tmp/mcp-workspace;allow-net',
    MCP_CONDUCTOR_DEFAULT_TIMEOUT: '30000',
  },

  zeroPermissions: {
    MCP_CONDUCTOR_WORKSPACE: '${HOME}/.mcp-conductor/workspace',
    MCP_CONDUCTOR_RUN_ARGS: '',
  },
}
