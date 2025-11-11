#!/usr/bin/env -S deno run --allow-all
/**
 * CLI for MCP Run Deno server
 */

import { parseArgs } from '@std/cli/parse-args'
import { runExample, runStdio, runStreamableHttp } from '../server/main.ts'
import type { ServerConfig } from '../types/types.ts'

const VERSION = '0.1.0'

async function main() {
  const args = parseArgs(Deno.args, {
    string: ['port', 'return-mode', 'timeout', 'max-timeout'],
    boolean: ['help', 'version', 'allow-net', 'allow-read', 'allow-write', 'allow-all'],
    default: {
      port: '3001',
      'return-mode': 'xml',
      timeout: '30000',
      'max-timeout': '300000',
    },
    alias: {
      h: 'help',
      v: 'version',
      p: 'port',
    },
  })

  // Show version
  if (args.version) {
    console.error(`mcp-run-deno v${VERSION}`)
    return
  }

  // Show help
  if (args.help || args._.length === 0) {
    showHelp()
    return
  }

  const mode = args._[0] as string

  // Build server config from CLI args
  const config: ServerConfig = {
    returnMode: args['return-mode'] as 'json' | 'yaml',
    defaultTimeout: parseInt(args.timeout),
    maxTimeout: parseInt(args['max-timeout']),
  }

  // Set default permissions based on flags
  if (args['allow-all']) {
    config.defaultPermissions = { all: true }
  } else {
    config.defaultPermissions = {
      net: args['allow-net'] || undefined,
      read: args['allow-read'] || undefined,
      write: args['allow-write'] || undefined,
    }
  }

  // Run in requested mode
  try {
    switch (mode) {
      case 'stdio':
        await runStdio(config)
        break

      case 'http':
      case 'streamable-http':
        {
          const port = parseInt(args.port)
          if (isNaN(port) || port < 1 || port > 65535) {
            console.error(`Error: Invalid port number: ${args.port}`)
            Deno.exit(1)
          }
          runStreamableHttp(port, config)
        }
        break

      case 'example':
        await runExample()
        break

      default:
        console.error(`Error: Unknown mode '${mode}'`)
        console.error('Run with --help for usage information')
        Deno.exit(1)
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error))
    Deno.exit(1)
  }
}

function showHelp() {
  console.error(`
MCP Run Deno v${VERSION}

USAGE:
  mcp-run-deno [OPTIONS] <MODE>

MODES:
  stdio              Run with stdio transport (for local MCP clients)
  http               Run with streamable HTTP transport (for remote clients)
  streamable-http    Alias for 'http'
  example            Run a simple example to test the server

OPTIONS:
  -h, --help                Show this help message
  -v, --version             Show version information
  -p, --port <PORT>         Port for HTTP server (default: 3001)
  --return-mode <MODE>      Output format: 'xml' or 'json' (default: xml)
  --timeout <MS>            Default execution timeout in ms (default: 30000)
  --max-timeout <MS>        Maximum allowed timeout in ms (default: 300000)
  
  Default Permissions (applied when not specified in tool call):
  --allow-net               Allow network access by default
  --allow-read              Allow file read access by default
  --allow-write             Allow file write access by default
  --allow-all               Allow all permissions by default (USE WITH CAUTION)

EXAMPLES:
  # Start server with stdio transport (secure by default)
  mcp-run-deno stdio

  # Start HTTP server on custom port
  mcp-run-deno http --port 8080

  # Allow network access by default
  mcp-run-deno stdio --allow-net

  # Run example to test
  mcp-run-deno example

SECURITY:
  By default, executed code has NO permissions (fully sandboxed).
  Permissions must be explicitly granted either:
  - Via CLI flags (applies to all executions)
  - Via tool parameters (applies per execution)

  Each execution runs in an isolated Deno subprocess with timeout protection.

DOCUMENTATION:
  https://github.com/your-org/mcp-run-deno
`)
}

// Run CLI
if (import.meta.main) {
  main()
}
