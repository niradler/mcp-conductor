import { join } from 'jsr:@std/path@^1'
import { parse as parseYaml } from 'jsr:@std/yaml@^1'
import type { PlaybookFile, PlaybookListItem, PlaybookMetadata } from '../types/playbook.ts'

const PLAYBOOK_FOLDER = 'playbooks'

export function getPlaybooksDir(rootDir: string): string {
  return join(rootDir, PLAYBOOK_FOLDER)
}

export async function ensurePlaybooksDir(rootDir: string): Promise<string> {
  const playbooksDir = getPlaybooksDir(rootDir)
  try {
    await Deno.mkdir(playbooksDir, { recursive: true })
  } catch {
    // Directory already exists
  }
  return playbooksDir
}

export async function parsePlaybookMarkdown(mdPath: string): Promise<{
  metadata: PlaybookMetadata
  content: string
}> {
  const text = await Deno.readTextFile(mdPath)

  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
  const match = text.match(frontmatterRegex)

  if (!match) {
    throw new Error(`Invalid playbook format: missing YAML frontmatter in ${mdPath}`)
  }

  const yamlContent = match[1]
  const markdownContent = match[2].trim()

  const metadata = parseYaml(yamlContent) as PlaybookMetadata

  if (!metadata.name || !metadata.description) {
    throw new Error('Playbook must have name and description in frontmatter')
  }

  return { metadata, content: markdownContent }
}

export async function listPlaybooks(rootDir: string): Promise<PlaybookListItem[]> {
  const playbooksDir = await ensurePlaybooksDir(rootDir)
  const playbooks: PlaybookListItem[] = []

  try {
    for await (const entry of Deno.readDir(playbooksDir)) {
      if (!entry.isDirectory) continue

      const folderPath = join(playbooksDir, entry.name)
      const mdPath = join(folderPath, 'playbook.md')
      const tsPath = join(folderPath, 'playbook.ts')

      try {
        const { metadata } = await parsePlaybookMarkdown(mdPath)

        let hasCode = false
        try {
          await Deno.stat(tsPath)
          hasCode = true
        } catch {
          // No code file
        }

        playbooks.push({
          name: metadata.name,
          description: metadata.description,
          folderName: entry.name,
          hasCode,
          source: metadata.source || 'user', // Default to 'user' if not specified
        })
      } catch (err) {
        console.error(`Failed to parse playbook ${entry.name}:`, err)
      }
    }
  } catch {
    // Playbooks directory doesn't exist or can't be read
  }

  return playbooks.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getPlaybook(rootDir: string, folderName: string): Promise<PlaybookFile> {
  const playbooksDir = getPlaybooksDir(rootDir)
  const folderPath = join(playbooksDir, folderName)
  const mdPath = join(folderPath, 'playbook.md')
  const tsPath = join(folderPath, 'playbook.ts')

  try {
    await Deno.stat(folderPath)
  } catch {
    throw new Error(`Playbook folder not found: ${folderName}`)
  }

  const { metadata, content } = await parsePlaybookMarkdown(mdPath)

  return {
    metadata,
    content,
    codePath: tsPath,
    folderPath,
  }
}

export async function createPlaybook(
  rootDir: string,
  folderName: string,
  metadata: PlaybookMetadata,
  markdownContent: string,
  codeContent?: string,
): Promise<string> {
  const playbooksDir = await ensurePlaybooksDir(rootDir)
  const folderPath = join(playbooksDir, folderName)

  await Deno.mkdir(folderPath, { recursive: true })

  const yamlFrontmatter = [
    'name: ' + metadata.name,
    'description: ' + metadata.description,
  ]

  if (metadata.author) yamlFrontmatter.push('author: ' + metadata.author)
  if (metadata.version) yamlFrontmatter.push('version: ' + metadata.version)
  if (metadata.tags && metadata.tags.length > 0) {
    yamlFrontmatter.push('tags:')
    metadata.tags.forEach((tag) => yamlFrontmatter.push('  - ' + tag))
  }

  yamlFrontmatter.push('source: ' + (metadata.source || 'user'))

  const mdContent = `---\n${yamlFrontmatter.join('\n')}\n---\n\n${markdownContent}`
  const mdPath = join(folderPath, 'playbook.md')
  await Deno.writeTextFile(mdPath, mdContent)

  if (codeContent) {
    const tsPath = join(folderPath, 'playbook.ts')
    await Deno.writeTextFile(tsPath, codeContent)
  }

  return folderPath
}
