import { join } from 'jsr:@std/path@^1'
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1'
import {
  createPlaybook,
  ensurePlaybooksDir,
  getPlaybook,
  getPlaybooksDir,
  listPlaybooks,
  parsePlaybookMarkdown,
} from '../src/executor/playbook.ts'

const TEST_ROOT = await Deno.makeTempDir({ prefix: 'mcp-playbook-test-' })

Deno.test('Playbook - getPlaybooksDir', () => {
  const dir = getPlaybooksDir(TEST_ROOT)
  assertStringIncludes(dir, 'playbooks')
  assertEquals(dir, join(TEST_ROOT, 'playbooks'))
})

Deno.test('Playbook - ensurePlaybooksDir', async () => {
  const dir = await ensurePlaybooksDir(TEST_ROOT)
  const stat = await Deno.stat(dir)
  assertEquals(stat.isDirectory, true)
})

Deno.test('Playbook - createPlaybook', async () => {
  const folderPath = await createPlaybook(
    TEST_ROOT,
    'test-playbook',
    {
      name: 'Test Playbook',
      description: 'A test playbook',
      author: 'Test Author',
      version: '1.0.0',
      tags: ['test', 'example'],
    },
    'This is the content of the playbook.',
    'export function testFunc() { return "hello"; }',
  )

  assertStringIncludes(folderPath, 'test-playbook')

  const mdContent = await Deno.readTextFile(join(folderPath, 'playbook.md'))
  assertStringIncludes(mdContent, 'name: Test Playbook')
  assertStringIncludes(mdContent, 'description: A test playbook')
  assertStringIncludes(mdContent, 'author: Test Author')
  assertStringIncludes(mdContent, 'version: 1.0.0')
  assertStringIncludes(mdContent, 'This is the content of the playbook.')

  const tsContent = await Deno.readTextFile(join(folderPath, 'playbook.ts'))
  assertStringIncludes(tsContent, 'export function testFunc')
})

Deno.test('Playbook - parsePlaybookMarkdown', async () => {
  const testMdPath = `${TEST_ROOT}/test-parse.md`
  const content = `---
name: Parse Test
description: Test parsing
author: Tester
tags:
  - tag1
  - tag2
---

# Content Here

This is the markdown content.`

  await Deno.writeTextFile(testMdPath, content)

  const { metadata, content: markdownContent } = await parsePlaybookMarkdown(testMdPath)

  assertEquals(metadata.name, 'Parse Test')
  assertEquals(metadata.description, 'Test parsing')
  assertEquals(metadata.author, 'Tester')
  assertEquals(metadata.tags, ['tag1', 'tag2'])
  assertStringIncludes(markdownContent, '# Content Here')
  assertStringIncludes(markdownContent, 'This is the markdown content.')

  await Deno.remove(testMdPath)
})

Deno.test('Playbook - listPlaybooks', async () => {
  await createPlaybook(
    TEST_ROOT,
    'playbook-1',
    { name: 'First', description: 'First playbook' },
    'Content 1',
  )

  await createPlaybook(
    TEST_ROOT,
    'playbook-2',
    { name: 'Second', description: 'Second playbook' },
    'Content 2',
    'export const code = true;',
  )

  const playbooks = await listPlaybooks(TEST_ROOT)

  assertEquals(playbooks.length >= 2, true)

  const first = playbooks.find((p) => p.folderName === 'playbook-1')
  assertEquals(first?.name, 'First')
  assertEquals(first?.description, 'First playbook')
  assertEquals(first?.hasCode, false)

  const second = playbooks.find((p) => p.folderName === 'playbook-2')
  assertEquals(second?.name, 'Second')
  assertEquals(second?.description, 'Second playbook')
  assertEquals(second?.hasCode, true)
})

Deno.test('Playbook - getPlaybook', async () => {
  await createPlaybook(
    TEST_ROOT,
    'get-test',
    {
      name: 'Get Test',
      description: 'Test getting playbook',
      version: '2.0.0',
    },
    'Playbook content here',
    'export const value = 42;',
  )

  const playbook = await getPlaybook(TEST_ROOT, 'get-test')

  assertEquals(playbook.metadata.name, 'Get Test')
  assertEquals(playbook.metadata.description, 'Test getting playbook')
  assertEquals(playbook.metadata.version, '2.0.0')
  assertStringIncludes(playbook.content, 'Playbook content here')
  assertStringIncludes(playbook.codePath, 'playbook.ts')
  assertStringIncludes(playbook.folderPath, 'get-test')
})

Deno.test('Playbook - cleanup test directory', async () => {
  await Deno.remove(TEST_ROOT, { recursive: true })
})
