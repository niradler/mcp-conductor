import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1'
import { RunCode } from '../src/executor/runCode.ts'
import { createPlaybook, getPlaybooksDir } from '../src/executor/playbook.ts'

const TEST_ROOT = await Deno.makeTempDir({ prefix: 'mcp-integration-test-' })
const TEST_WORKSPACE = `${TEST_ROOT}/workspace`
await Deno.mkdir(TEST_WORKSPACE, { recursive: true })

Deno.test('Integration - Inject globals into code execution', async () => {
  const runCode = new RunCode(
    ['--allow-read', '--allow-net'],
    TEST_WORKSPACE,
  )

  const playbooksDir = getPlaybooksDir(TEST_ROOT)
  runCode.setPlaybooksDir(playbooksDir)
  runCode.setRootDir(TEST_ROOT)

  const code = `
const result = {
  workspace: globalThis.WORKSPACE_DIR,
  playbooks: globalThis.PLAYBOOKS_DIR,
  root: globalThis.ROOT_DIR,
  permissions: globalThis.PERMISSIONS,
};

result
`

  const result = await runCode.run({ code, timeout: 5000 })

  assertEquals(result.status, 'success')
  if (result.status === 'success' && result.returnValue) {
    const parsed = JSON.parse(result.returnValue)
    assertStringIncludes(parsed.workspace, 'workspace')
    assertStringIncludes(parsed.playbooks, 'playbooks')
    assertStringIncludes(parsed.root, TEST_ROOT)
    assertEquals(Array.isArray(parsed.permissions), true)
    assertEquals(parsed.permissions.includes('--allow-read'), true)
  }
})

Deno.test('Integration - Import from playbook', async () => {
  await createPlaybook(
    TEST_ROOT,
    'math-utils',
    {
      name: 'Math Utils',
      description: 'Math utility functions',
    },
    'Math utility functions',
    `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}`,
  )

  const runCode = new RunCode(
    ['--allow-read=' + TEST_ROOT],
    TEST_WORKSPACE,
  )

  const playbooksDir = getPlaybooksDir(TEST_ROOT)
  runCode.setPlaybooksDir(playbooksDir)
  runCode.setRootDir(TEST_ROOT)

  const code = `
const { add, multiply } = await importPlaybook('math-utils');

const result = {
  sum: add(5, 3),
  product: multiply(4, 7),
};

result
`

  const result = await runCode.run({ code, timeout: 5000 })

  if (result.status === 'error') {
    console.error('Error:', result.error)
    console.error('Output:', result.output)
  }

  assertEquals(result.status, 'success')
  if (result.status === 'success' && result.returnValue) {
    const parsed = JSON.parse(result.returnValue)
    assertEquals(parsed.sum, 8)
    assertEquals(parsed.product, 28)
  }
})

Deno.test('Integration - Import using helper function', async () => {
  await createPlaybook(
    TEST_ROOT,
    'string-utils',
    {
      name: 'String Utils',
      description: 'String utility functions',
    },
    'String utilities',
    `export function toUpperCase(str: string): string {
  return str.toUpperCase();
}

export function reverse(str: string): string {
  return str.split('').reverse().join('');
}`,
  )

  const runCode = new RunCode(
    ['--allow-read=' + TEST_ROOT],
    TEST_WORKSPACE,
  )

  const playbooksDir = getPlaybooksDir(TEST_ROOT)
  runCode.setPlaybooksDir(playbooksDir)
  runCode.setRootDir(TEST_ROOT)

  const code = `
const { toUpperCase, reverse } = await importPlaybook('string-utils');

const result = {
  upper: toUpperCase('hello'),
  reversed: reverse('world'),
};

result
`

  const result = await runCode.run({ code, timeout: 5000 })

  if (result.status === 'error') {
    console.error('Error:', result.error)
    console.error('Output:', result.output)
  }

  assertEquals(result.status, 'success')
  if (result.status === 'success' && result.returnValue) {
    const parsed = JSON.parse(result.returnValue)
    assertEquals(parsed.upper, 'HELLO')
    assertEquals(parsed.reversed, 'dlrow')
  }
})

Deno.test('Integration - cleanup test directory', async () => {
  await Deno.remove(TEST_ROOT, { recursive: true })
})
