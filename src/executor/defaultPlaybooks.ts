import { dirname, join } from 'node:path'

const DEFAULT_PLAYBOOKS_SOURCE = 'playbooks'

/**
 * Copy default playbooks from playbooks/ to user's directory
 * @param rootDir - The root directory where playbooks are stored
 */
export async function ensureDefaultPlaybooks(rootDir: string): Promise<void> {
  const targetDir = join(rootDir, 'playbooks')
  await Deno.mkdir(targetDir, { recursive: true })

  // Find the source directory (relative to this file or absolute)
  const sourceDir = getSourcePlaybooksDir()

  // Check if source exists
  try {
    await Deno.stat(sourceDir)
  } catch {
    console.error(`⚠️  Default playbooks not found at ${sourceDir}`)
    return
  }

  // Copy each system playbook
  for await (const entry of Deno.readDir(sourceDir)) {
    if (!entry.isDirectory) continue

    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)
    const mdSource = join(sourcePath, 'playbook.md')
    const mdTarget = join(targetPath, 'playbook.md')

    // Check if it's a system playbook
    let isSystemPlaybook = false
    try {
      const content = await Deno.readTextFile(mdSource)
      isSystemPlaybook = content.includes('source: system')
    } catch {
      continue
    }

    if (!isSystemPlaybook) continue

    // Check if we should skip (user has modified it)
    try {
      const existingContent = await Deno.readTextFile(mdTarget)
      if (!existingContent.includes('source: system')) {
        continue // User modified it, don't override
      }
    } catch {
      // Doesn't exist, will install
    }

    // Copy the playbook
    try {
      await copyPlaybookFolder(sourcePath, targetPath)
      console.log(`✓ Installed default playbook: ${entry.name}`)
    } catch (error) {
      console.error(`Failed to install ${entry.name}:`, error)
    }
  }
}

function getSourcePlaybooksDir(): string {
  // Try to find playbooks directory relative to this file
  let modulePath = new URL(import.meta.url).pathname

  // Fix Windows path (remove leading slash from /C:/)
  if (Deno.build.os === 'windows' && /^\/[A-Za-z]:/.test(modulePath)) {
    modulePath = modulePath.slice(1)
  }

  const moduleDir = dirname(modulePath)
  const projectRoot = join(moduleDir, '..', '..')
  return join(projectRoot, DEFAULT_PLAYBOOKS_SOURCE)
}

async function copyPlaybookFolder(source: string, target: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true })

  for await (const entry of Deno.readDir(source)) {
    if (entry.isFile) {
      const srcFile = join(source, entry.name)
      const tgtFile = join(target, entry.name)
      await Deno.copyFile(srcFile, tgtFile)
    }
  }
}
