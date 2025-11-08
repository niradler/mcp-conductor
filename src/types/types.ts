/**
 * Shared type definitions for mcp-run-deno
 */

import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js'

/**
 * Deno permissions configuration
 */
export interface DenoPermissions {
  /** Allow network access. Can be true, false, or array of allowed domains */
  net?: boolean | string[]
  /** Allow file system read. Can be true, false, or array of allowed paths */
  read?: boolean | string[]
  /** Allow file system write. Can be true, false, or array of allowed paths */
  write?: boolean | string[]
  /** Allow environment variable access */
  env?: boolean | string[]
  /** Allow running subprocesses */
  run?: boolean | string[]
  /** Allow FFI (Foreign Function Interface) */
  ffi?: boolean | string[]
  /** Allow high resolution time measurement */
  hrtime?: boolean
  /** Allow all permissions */
  all?: boolean
}

/**
 * Code execution options
 */
export interface ExecutionOptions {
  /** The code to execute */
  code: string
  /** Permissions for the code execution */
  permissions?: DenoPermissions
  /** Execution timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Global variables to inject into the execution context */
  globals?: Record<string, unknown>
  /** Working directory for code execution */
  cwd?: string
  /** NPM/JSR dependencies to install (e.g., ['npm:axios@1.6.0', 'jsr:@std/path']) */
  dependencies?: string[]
}

/**
 * Successful execution result
 */
export interface RunSuccess {
  status: 'success'
  /** Combined stdout and stderr output */
  output: string[]
  /** Serialized return value from the last expression */
  returnValue: string | null
  /** Execution time in milliseconds */
  executionTime: number
}

/**
 * Failed execution result
 */
export interface RunError {
  status: 'error'
  /** Combined stdout and stderr output */
  output: string[]
  /** Error message */
  error: string
  /** Error type (syntax, runtime, timeout) */
  errorType: 'syntax' | 'runtime' | 'timeout' | 'permission'
  /** Execution time in milliseconds */
  executionTime: number
}

/**
 * Code execution result (success or error)
 */
export type RunResult = RunSuccess | RunError

/**
 * Logging callback function
 */
export type LogHandler = (level: LoggingLevel, message: string) => void

/**
 * Server configuration
 */
export interface ServerConfig {
  /** Default permissions for code execution */
  defaultPermissions?: DenoPermissions
  /** Default timeout in milliseconds */
  defaultTimeout?: number
  /** Maximum allowed timeout in milliseconds */
  maxTimeout?: number
  /** Return mode for results */
  returnMode?: 'json' | 'xml'
  /** Workspace directory for file operations (default: ~/.mcp-conductor/sessions) */
  workspaceDir?: string
  /** Allowed dependencies - array of allowed packages or true for all */
  allowedDependencies?: string[] | true
  /** Default Deno run arguments when no permissions specified (e.g., ['--no-prompt', '--allow-read=/tmp']) */
  defaultRunArgs?: string[]
}

/**
 * CLI mode
 */
export type ServerMode = 'stdio' | 'streamable-http' | 'example'
