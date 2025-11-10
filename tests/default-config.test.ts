/**
 * Tests for default configuration
 * These tests validate the ACTUAL default config is secure and working
 */

import { assertEquals } from 'jsr:@std/assert@1'
import { RunCode } from '../src/executor/runCode.ts'
import { SECURE_DEFAULTS } from '../src/server/config.ts'

// Test the actual default configuration
const DEFAULT_ARGS = SECURE_DEFAULTS.runArgs

Deno.test('Default config: Verify flags are valid', async () => {
  // This test will fail if default flags are invalid
  const runCode = new RunCode(DEFAULT_ARGS)
  const result = await runCode.run({
    code: 'const x = 1 + 1; x',
    timeout: 5000,
  })

  assertEquals(result.status, 'success')
  if (result.status === 'success') {
    assertEquals(result.returnValue, '2')
  }
})

Deno.test('Default config: Remote imports blocked', async () => {
  const runCode = new RunCode(DEFAULT_ARGS)
  const result = await runCode.run({
    code: `await import('https://deno.land/std/version.ts')`,
    timeout: 5000,
  })

  assertEquals(result.status, 'error')
  if (result.status === 'error') {
    // Should be permission or runtime error (not syntax)
    assertEquals(['permission', 'runtime'].includes(result.errorType), true)
  }
})

Deno.test('Default config: Data URL imports allowed but sandboxed', async () => {
  // Per Deno security model: data: URLs, eval, Function are allowed by design
  // The security boundary is the permission sandbox, not code execution
  const runCode = new RunCode(DEFAULT_ARGS)
  const result = await runCode.run({
    code: `const mod = await import('data:text/javascript,export default 42'); mod.default`,
    timeout: 5000,
  })

  // This succeeds because Deno allows executing code at same privilege level
  assertEquals(result.status, 'success')
  if (result.status === 'success') {
    assertEquals(result.returnValue, '42')
  }
})

Deno.test('Default config: Filesystem access blocked', async () => {
  const runCode = new RunCode(DEFAULT_ARGS)
  const result = await runCode.run({
    code: `await Deno.readTextFile('/etc/hosts')`,
    timeout: 5000,
  })

  assertEquals(result.status, 'error')
  if (result.status === 'error') {
    assertEquals(result.errorType, 'permission')
  }
})

Deno.test('Default config: Network access blocked', async () => {
  const runCode = new RunCode(DEFAULT_ARGS)
  const result = await runCode.run({
    code: `await fetch('https://google.com')`,
    timeout: 5000,
  })

  assertEquals(result.status, 'error')
  if (result.status === 'error') {
    assertEquals(result.errorType, 'permission')
  }
})

Deno.test('Default config: Env access blocked', async () => {
  const runCode = new RunCode(DEFAULT_ARGS)
  const result = await runCode.run({
    code: `Deno.env.get('PATH')`,
    timeout: 5000,
  })

  assertEquals(result.status, 'error')
  if (result.status === 'error') {
    assertEquals(result.errorType, 'permission')
  }
})

Deno.test('Default config: Subprocess blocked', async () => {
  const runCode = new RunCode(DEFAULT_ARGS)
  const result = await runCode.run({
    code: `await new Deno.Command('echo', { args: ['test'] }).output()`,
    timeout: 5000,
  })

  assertEquals(result.status, 'error')
  if (result.status === 'error') {
    // May be permission or runtime depending on OS
    assertEquals(['permission', 'runtime'].includes(result.errorType), true)
  }
})
