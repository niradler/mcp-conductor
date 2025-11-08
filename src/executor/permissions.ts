/**
 * Permission management utilities for Deno code execution
 */

import type { DenoPermissions } from '../types/types.ts'

/**
 * Converts permission configuration to Deno CLI arguments
 */
export class PermissionBuilder {
  private permissions: DenoPermissions

  constructor(permissions: DenoPermissions = {}) {
    this.permissions = permissions
  }

  /**
   * Build Deno permission flags as command-line arguments
   * @returns Array of permission flags
   */
  build(): string[] {
    const flags: string[] = []
    const perms = this.permissions

    // If all permissions are granted, just use --allow-all
    if (perms.all) {
      return ['--allow-all']
    }

    // Network permissions
    if (perms.net === true) {
      flags.push('--allow-net')
    } else if (Array.isArray(perms.net) && perms.net.length > 0) {
      flags.push(`--allow-net=${perms.net.join(',')}`)
    }

    // Read permissions
    if (perms.read === true) {
      flags.push('--allow-read')
    } else if (Array.isArray(perms.read) && perms.read.length > 0) {
      flags.push(`--allow-read=${perms.read.join(',')}`)
    }

    // Write permissions
    if (perms.write === true) {
      flags.push('--allow-write')
    } else if (Array.isArray(perms.write) && perms.write.length > 0) {
      flags.push(`--allow-write=${perms.write.join(',')}`)
    }

    // Environment permissions
    if (perms.env === true) {
      flags.push('--allow-env')
    } else if (Array.isArray(perms.env) && perms.env.length > 0) {
      flags.push(`--allow-env=${perms.env.join(',')}`)
    }

    // Run permissions
    if (perms.run === true) {
      flags.push('--allow-run')
    } else if (Array.isArray(perms.run) && perms.run.length > 0) {
      flags.push(`--allow-run=${perms.run.join(',')}`)
    }

    // FFI permissions
    if (perms.ffi === true) {
      flags.push('--allow-ffi')
    } else if (Array.isArray(perms.ffi) && perms.ffi.length > 0) {
      flags.push(`--allow-ffi=${perms.ffi.join(',')}`)
    }

    // High-resolution time permissions
    if (perms.hrtime === true) {
      flags.push('--allow-hrtime')
    }

    return flags
  }

  /**
   * Merge multiple permission configurations
   * @param base Base permissions
   * @param override Override permissions
   * @returns Merged permissions
   */
  static merge(base: DenoPermissions, override: DenoPermissions): DenoPermissions {
    return {
      ...base,
      ...override,
    }
  }

  /**
   * Validate permission configuration
   * @param permissions Permissions to validate
   * @throws Error if permissions are invalid
   */
  static validate(permissions: DenoPermissions): void {
    // Check that array permissions are actually arrays of strings
    const arrayPerms: Array<keyof DenoPermissions> = ['net', 'read', 'write', 'env', 'run', 'ffi']

    for (const key of arrayPerms) {
      const value = permissions[key]
      if (value !== undefined && value !== true && value !== false) {
        if (!Array.isArray(value)) {
          throw new Error(`Permission '${key}' must be boolean or string array`)
        }
        if (!value.every((v) => typeof v === 'string')) {
          throw new Error(`Permission '${key}' array must contain only strings`)
        }
      }
    }

    // Check boolean permissions
    if (permissions.hrtime !== undefined && typeof permissions.hrtime !== 'boolean') {
      throw new Error("Permission 'hrtime' must be boolean")
    }

    if (permissions.all !== undefined && typeof permissions.all !== 'boolean') {
      throw new Error("Permission 'all' must be boolean")
    }
  }

  /**
   * Get a secure default permission set (no permissions)
   */
  static getSecureDefaults(): DenoPermissions {
    return {}
  }

  /**
   * Get a development permission set (commonly needed permissions)
   */
  static getDevelopmentDefaults(): DenoPermissions {
    return {
      net: true,
      read: true,
      env: true,
    }
  }
}
