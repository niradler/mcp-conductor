/**
 * Workspace management for MCP Conductor
 * Creates and manages session-specific workspace directories
 */

import { join } from 'node:path'
import { getWorkspaceDir, ensureDir } from '../common/paths.ts'

export function getWorkspaceBaseDir(): string {
  return getWorkspaceDir()
}

export async function ensureWorkspaceDir(workspaceDir?: string): Promise<string> {
  const baseDir = workspaceDir || getWorkspaceBaseDir()
  await ensureDir(baseDir)
  return baseDir
}

/**
 * Create a session-specific workspace directory
 */
export async function createSessionWorkspace(
  sessionId: string,
  workspaceDir?: string,
): Promise<string> {
  const baseDir = await ensureWorkspaceDir(workspaceDir)
  const sessionDir = join(baseDir, sessionId)

  await Deno.mkdir(sessionDir, { recursive: true })

  return sessionDir
}

/**
 * Clean up old session directories (older than specified days)
 */
export async function cleanupOldSessions(
  maxAgeDays: number = 7,
  workspaceDir?: string,
): Promise<number> {
  const baseDir = workspaceDir || getWorkspaceBaseDir()
  let cleaned = 0

  try {
    const now = Date.now()
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000

    for await (const entry of Deno.readDir(baseDir)) {
      if (!entry.isDirectory) continue

      const sessionPath = join(baseDir, entry.name)
      const stat = await Deno.stat(sessionPath)

      if (stat.mtime) {
        const age = now - stat.mtime.getTime()
        if (age > maxAgeMs) {
          await Deno.remove(sessionPath, { recursive: true })
          cleaned++
        }
      }
    }
  } catch (error) {
    // If base dir doesn't exist, nothing to clean
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error
    }
  }

  return cleaned
}

/**
 * Get secure default permissions for workspace access
 */
export function getWorkspacePermissions(workspaceDir: string) {
  return {
    read: [workspaceDir],
    write: [workspaceDir],
  }
}
