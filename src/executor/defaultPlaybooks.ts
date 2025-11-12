import { dirname, fromFileUrl, join } from 'jsr:@std/path@^1'

const DEFAULT_PLAYBOOKS_SOURCE = 'playbooks'

/**
 * Copy default playbooks from playbooks/ to user's directory
 * @param rootDir - The root directory where playbooks are stored
 */
export async function ensureDefaultPlaybooks(rootDir: string): Promise<void> {
  const targetDir = join(rootDir, 'playbooks')
  await Deno.mkdir(targetDir, { recursive: true })

  const sourceDir = getSourcePlaybooksDir()

  try {
    await Deno.stat(sourceDir)
  } catch {
    console.error(`⚠️  Default playbooks not found at ${sourceDir}`)
    return
  }

  for await (const entry of Deno.readDir(sourceDir)) {
    if (!entry.isDirectory) continue

    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)
    const mdSource = join(sourcePath, 'playbook.md')
    const mdTarget = join(targetPath, 'playbook.md')

    let isSystemPlaybook = false
    try {
      const content = await Deno.readTextFile(mdSource)
      isSystemPlaybook = content.includes('source: system')
    } catch {
      continue
    }

    if (!isSystemPlaybook) continue

    try {
      const existingContent = await Deno.readTextFile(mdTarget)
      if (!existingContent.includes('source: system')) {
        continue
      }
    } catch {
      // File doesn't exist, will install
    }

    try {
      await copyPlaybookFolder(sourcePath, targetPath)
      console.log(`✓ Installed default playbook: ${entry.name}`)
    } catch (error) {
      console.error(`Failed to install ${entry.name}:`, error)
    }
  }
}

function getSourcePlaybooksDir(): string {
  const modulePath = fromFileUrl(import.meta.url)
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
