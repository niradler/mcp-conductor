#!/usr/bin/env -S deno run --allow-all

/**
 * Quick validation script to test mcp-run-deno installation
 * Run: deno run --allow-all validate.ts
 */

import { RunCode } from '../src/executor/runCode.ts'

console.log('🧪 MCP Run Deno - Validation Script\n')
console.log('='.repeat(50))

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<boolean>) {
  try {
    console.log(`\n▶ Testing: ${name}`)
    const result = await fn()
    if (result) {
      console.log('  ✅ PASSED')
      passed++
    } else {
      console.log('  ❌ FAILED')
      failed++
    }
  } catch (error) {
    console.log('  ❌ ERROR:', error instanceof Error ? error.message : String(error))
    failed++
  }
}

const runCode = new RunCode()

// Test 1: Basic execution
await test('Basic code execution', async () => {
  const result = await runCode.run({
    code: 'const x = 5 + 3; x',
    permissions: {},
  })
  return result.status === 'success' && result.returnValue === '8'
})

// Test 2: Console output
await test('Console output capture', async () => {
  const result = await runCode.run({
    code: 'console.log("test"); 42',
    permissions: {},
  })
  return result.status === 'success' && result.output.length > 0
})

// Test 3: Async code
await test('Async code execution', async () => {
  const result = await runCode.run({
    code: 'await Promise.resolve(123)',
    permissions: {},
  })
  return result.status === 'success' && result.returnValue === '123'
})

// Test 4: Error handling
await test('Syntax error handling', async () => {
  const result = await runCode.run({
    code: 'const x = {{{',
    permissions: {},
  })
  return result.status === 'error' && result.errorType === 'syntax'
})

// Test 5: Permission enforcement
await test('Permission enforcement', async () => {
  const result = await runCode.run({
    code: 'await Deno.readTextFile("/nonexistent")',
    permissions: {}, // No read permission
  })
  return result.status === 'error' && result.errorType === 'permission'
})

// Test 6: Timeout enforcement
await test('Timeout enforcement', async () => {
  const result = await runCode.run({
    code: 'while (true) {}',
    permissions: {},
    timeout: 1000,
  })
  return result.status === 'error' && result.errorType === 'timeout'
})

// Test 7: Variable assignment
await test('Variable assignment', async () => {
  const result = await runCode.run({
    code: 'const x = 10; const y = 20; x + y',
    permissions: {},
  })
  return result.status === 'success' && result.returnValue === '30'
})

// Test 8: Complex return values
await test('Complex return values', async () => {
  const result = await runCode.run({
    code: '({ name: "test", value: 42 })',
    permissions: {},
  })
  if (result.status === 'success' && result.returnValue) {
    const parsed = JSON.parse(result.returnValue)
    return parsed.name === 'test' && parsed.value === 42
  }
  return false
})

// Summary
console.log('\n' + '='.repeat(50))
console.log('\n📊 Test Summary:')
console.log(`   ✅ Passed: ${passed}`)
console.log(`   ❌ Failed: ${failed}`)
console.log(`   📈 Total:  ${passed + failed}`)

if (failed === 0) {
  console.log('\n✨ All tests passed! mcp-run-deno is ready to use.')
  console.log('\n🚀 Next steps:')
  console.log('   - Run: deno task start example')
  console.log('   - Run: deno task start stdio')
  console.log('   - Check: README.md for full documentation')
  Deno.exit(0)
} else {
  console.log('\n⚠️  Some tests failed. Please check the errors above.')
  Deno.exit(1)
}
