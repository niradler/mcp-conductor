/**
 * Tests for the Deno code executor
 */

import { assert, assertEquals, assertExists } from '@std/assert'
import { RunCode } from '../src/executor/runCode.ts'

Deno.test('RunCode - execute simple code', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: 'const x = 5 + 3; x',
    permissions: {},
  })

  assertEquals(result.status, 'success')
  if (result.status === 'success') {
    assertEquals(result.returnValue, '8')
    assertEquals(result.output.length, 0)
  }
})

Deno.test('RunCode - capture console output', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: `
      console.log('Hello, world!')
      console.log('Line 2')
      42
    `,
    permissions: {},
  })

  assertEquals(result.status, 'success')
  if (result.status === 'success') {
    assertEquals(result.returnValue, '42')
    assertEquals(result.output.length >= 2, true)
  }
})

Deno.test('RunCode - handle async code', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: `
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
      await delay(100)
      'async result'
    `,
    permissions: {},
  })

  assertEquals(result.status, 'success')
  if (result.status === 'success') {
    assertEquals(result.returnValue, '"async result"')
  }
})

Deno.test('RunCode - handle syntax errors', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: 'const x = {{{',
    permissions: {},
  })

  assertEquals(result.status, 'error')
  if (result.status === 'error') {
    assertEquals(result.errorType, 'syntax')
    assertExists(result.error)
  }
})

Deno.test('RunCode - handle runtime errors', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: 'throw new Error("Test error")',
    permissions: {},
  })

  assertEquals(result.status, 'error')
  if (result.status === 'error') {
    assertEquals(result.errorType, 'runtime')
    assertExists(result.error)
  }
})

Deno.test('RunCode - enforce timeout', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: 'while (true) {}',
    permissions: {},
    timeout: 1000,
  })

  assertEquals(result.status, 'error')
  if (result.status === 'error') {
    assertEquals(result.errorType, 'timeout')
  }
})

Deno.test('RunCode - handle permission denied', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: 'await Deno.readTextFile("/etc/passwd")',
    permissions: {}, // No read permission
  })

  assertEquals(result.status, 'error')
  if (result.status === 'error') {
    assertEquals(result.errorType, 'permission')
  }
})

Deno.test('RunCode - grant network permission', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: `
      const response = await fetch('https://api.github.com')
      response.status
    `,
    permissions: { net: true },
    timeout: 10000,
  })

  assertEquals(result.status, 'success')
  if (result.status === 'success') {
    assertEquals(result.returnValue, '200')
  }
})

Deno.test('RunCode - inject global variables', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: 'x + y',
    permissions: {},
    globals: { x: 10, y: 20 },
  })

  assertEquals(result.status, 'success')
  if (result.status === 'success') {
    assertEquals(result.returnValue, '30')
  }
})

Deno.test('RunCode - handle complex return values', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: '({ name: "test", value: 42, nested: { arr: [1, 2, 3] } })',
    permissions: {},
  })

  assertEquals(result.status, 'success')
  if (result.status === 'success') {
    const parsed = JSON.parse(result.returnValue!)
    assertEquals(parsed.name, 'test')
    assertEquals(parsed.value, 42)
    assertEquals(parsed.nested.arr.length, 3)
  }
})

Deno.test('RunCode - install and use dependencies', async () => {
  const runCode = new RunCode()
  const result = await runCode.run({
    code: `
import { join } from 'jsr:@std/path'

const path = join('folder', 'file.txt')
console.log('Joined path:', path)

path
`,
    permissions: {},
    dependencies: ['jsr:@std/path'],
    timeout: 60000,
  })

  if (result.status === 'error') {
    console.error('Dependency test failed:')
    console.error('Error:', result.error)
    console.error('Output:', result.output)
  }

  assertEquals(result.status, 'success')
  if (result.status === 'success') {
    assertExists(result.returnValue)
    assert(result.returnValue.includes('folder'))
    assert(result.output.some((line) => line.includes('Joined path')))
  }
})
