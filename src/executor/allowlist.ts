/**
 * Default package allowlist for MCP Conductor
 *
 * These packages are commonly used by LLM agents and are considered safe.
 * Users can override this list or set to `true` to allow all packages.
 */

export const DEFAULT_ALLOWED_DEPENDENCIES = [
  // Deno Standard Library - Core utilities
  'jsr:@std/path@^1', // File path manipulation
  'jsr:@std/fs@^1', // File system utilities
  'jsr:@std/encoding@^1', // Base64, hex, etc.
  'jsr:@std/datetime@^1', // Date/time utilities
  'jsr:@std/collections@^1', // Array/Map utilities
  'jsr:@std/uuid@^1', // UUID generation
  'jsr:@std/json@^1', // JSON utilities
  'jsr:@std/yaml@^1', // YAML parsing
  'jsr:@std/csv@^1', // CSV parsing

  // HTTP & API Client
  'npm:axios@^1', // Popular HTTP client
  'npm:ky@^1', // Modern fetch wrapper

  // Data Processing
  'npm:lodash@^4', // Utility functions
  'npm:date-fns@^4', // Date manipulation
  'npm:zod@^4', // Schema validation

  // Additional useful packages
  'npm:chalk@^5', // Terminal colors (for output)
  'npm:cheerio@^1', // HTML parsing
  'npm:marked@^17', // Markdown parsing
]

/**
 * Validate package specifier format
 * Prevents injection attacks via malformed package names
 */
function isValidPackageSpecifier(dependency: string): boolean {
  // Must start with npm: or jsr:
  if (!dependency.startsWith('npm:') && !dependency.startsWith('jsr:')) {
    return false
  }

  // Extract package name and version
  const [, rest] = dependency.split(':')
  if (!rest) return false

  // Check for suspicious characters that could be injection attempts
  const suspiciousChars = [';', '\n', '\r', "'", '"', '`', '\\', '$', '(', ')']
  if (suspiciousChars.some((char) => rest.includes(char))) {
    return false
  }

  // Valid package name patterns:
  // npm:package@version
  // npm:@scope/package@version
  // jsr:@scope/package@version
  const validPattern = /^(@?[\w-]+\/)?[\w-]+(@[\w\.\-\^~>=<*]+)?$/
  return validPattern.test(rest)
}

/**
 * Normalize package specifier for comparison
 * Removes version info to compare base packages
 */
function normalizePackage(dependency: string): string {
  // Split by @ but be careful with scoped packages
  const parts = dependency.split('@')

  if (dependency.startsWith('npm:@') || dependency.startsWith('jsr:@')) {
    // Scoped package: npm:@scope/package@version -> ["npm:", "scope/package", "version"]
    // Keep: npm:@scope/package -> rejoin first 3 parts
    return parts.slice(0, 3).join('@')
  } else {
    // Regular package: npm:package@version -> ["npm:package", "version"]
    // Keep: npm:package -> just first part
    return parts[0]
  }
}

/**
 * Extract version constraint from allowlist entry
 */
function getVersionConstraint(allowedDep: string): string | null {
  const atIndex = allowedDep.lastIndexOf('@')
  if (atIndex === -1) return null

  // For scoped packages, skip the first @
  if (allowedDep.startsWith('npm:@') || allowedDep.startsWith('jsr:@')) {
    const secondAtIndex = allowedDep.indexOf('@', 5)
    if (secondAtIndex === -1) return null
    return allowedDep.substring(secondAtIndex + 1)
  }

  return allowedDep.substring(atIndex + 1)
}

/**
 * Check if a dependency is allowed
 * Now accepts dependencies without versions - they'll be enriched later
 */
export function isDependencyAllowed(
  dependency: string,
  allowedList: string[] | true,
): boolean {
  // If true, all dependencies are allowed
  if (allowedList === true) {
    return true
  }

  // SECURITY: Validate format first
  if (!isValidPackageSpecifier(dependency)) {
    console.error(`Invalid package specifier format: ${dependency}`)
    return false
  }

  const normalizedDep = normalizePackage(dependency)

  // Check if dependency is in allowlist
  for (const allowed of allowedList) {
    const normalizedAllowed = normalizePackage(allowed)

    // Exact base package match
    if (normalizedDep === normalizedAllowed) {
      return true
    }
  }

  return false
}

/**
 * Enrich dependency with version from allowlist if not specified
 * Example: 'npm:axios' -> 'npm:axios@^1' (using allowlist version)
 */
export function enrichDependencyWithVersion(
  dependency: string,
  allowedList: string[],
): string {
  // If dependency already has a version, return as-is
  const normalizedDep = normalizePackage(dependency)
  if (normalizedDep !== dependency) {
    return dependency // Already has version
  }

  // Find matching entry in allowlist
  for (const allowed of allowedList) {
    const normalizedAllowed = normalizePackage(allowed)
    if (normalizedDep === normalizedAllowed) {
      // Get version from allowlist
      const constraint = getVersionConstraint(allowed)
      if (constraint) {
        return `${dependency}@${constraint}`
      }
      return dependency // No version in allowlist either
    }
  }

  return dependency // Not found, return as-is
}

/**
 * Validate dependencies against allowlist
 * Returns enriched dependencies with versions injected from allowlist
 */
export function validateDependencies(
  dependencies: string[],
  allowedList: string[] | true = DEFAULT_ALLOWED_DEPENDENCIES,
): { valid: boolean; invalid: string[]; errors: string[]; enriched: string[] } {
  if (allowedList === true) {
    // Still validate format even if all allowed
    const formatErrors: string[] = []
    for (const dep of dependencies) {
      if (!isValidPackageSpecifier(dep)) {
        formatErrors.push(`Invalid format: ${dep}`)
      }
    }

    return {
      valid: formatErrors.length === 0,
      invalid: formatErrors.length > 0 ? dependencies : [],
      errors: formatErrors,
      enriched: dependencies, // No enrichment if all allowed
    }
  }

  const invalid: string[] = []
  const errors: string[] = []
  const enriched: string[] = []

  for (const dep of dependencies) {
    // Enrich dependency with version from allowlist
    const enrichedDep = enrichDependencyWithVersion(dep, allowedList)

    if (!isDependencyAllowed(enrichedDep, allowedList)) {
      invalid.push(dep)
      if (!isValidPackageSpecifier(dep)) {
        errors.push(`Invalid format: ${dep}`)
      } else {
        errors.push(`Not in allowlist: ${dep}`)
      }
    } else {
      enriched.push(enrichedDep)
    }
  }

  return {
    valid: invalid.length === 0,
    invalid,
    errors,
    enriched,
  }
}
