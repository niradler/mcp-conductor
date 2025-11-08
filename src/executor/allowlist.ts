/**
 * Default package allowlist for MCP Conductor
 *
 * These packages are commonly used by LLM agents and are considered safe.
 * Users can override this list or set to `true` to allow all packages.
 */

export const DEFAULT_ALLOWED_DEPENDENCIES = [
  // Deno Standard Library - Core utilities
  'jsr:@std/path', // File path manipulation
  'jsr:@std/fs', // File system utilities
  'jsr:@std/encoding', // Base64, hex, etc.
  'jsr:@std/datetime', // Date/time utilities
  'jsr:@std/collections', // Array/Map utilities
  'jsr:@std/uuid', // UUID generation
  'jsr:@std/json', // JSON utilities
  'jsr:@std/yaml', // YAML parsing
  'jsr:@std/csv', // CSV parsing

  // HTTP & API Client
  'npm:axios', // Popular HTTP client
  'npm:ky', // Modern fetch wrapper

  // Data Processing
  'npm:lodash', // Utility functions
  'npm:date-fns', // Date manipulation
  'npm:zod', // Schema validation

  // Additional useful packages
  'npm:chalk', // Terminal colors (for output)
  'npm:cheerio', // HTML parsing
  'npm:marked', // Markdown parsing
]

/**
 * Check if a dependency is allowed
 */
export function isDependencyAllowed(
  dependency: string,
  allowedList: string[] | true,
): boolean {
  // If true, all dependencies are allowed
  if (allowedList === true) {
    return true
  }

  // Check if dependency is in allowlist
  // Support both exact match and prefix match (for versions)
  return allowedList.some((allowed) => {
    // Exact match
    if (dependency === allowed) return true

    // Prefix match (e.g., "npm:axios@1.0.0" matches "npm:axios")
    if (dependency.startsWith(allowed + '@')) return true

    return false
  })
}

/**
 * Validate dependencies against allowlist
 */
export function validateDependencies(
  dependencies: string[],
  allowedList: string[] | true = DEFAULT_ALLOWED_DEPENDENCIES,
): { valid: boolean; invalid: string[] } {
  if (allowedList === true) {
    return { valid: true, invalid: [] }
  }

  const invalid = dependencies.filter((dep) => !isDependencyAllowed(dep, allowedList))

  return {
    valid: invalid.length === 0,
    invalid,
  }
}
