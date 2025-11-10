/**
 * Basic usage example for mcp-run-deno
 */

import { RunCode } from '../src/executor/runCode.ts'

console.log('=== MCP Run Deno - Basic Example ===\n')

const runCode = new RunCode()

// Example 1: Simple calculation
console.log('1. Simple Calculation:')
const result1 = await runCode.run({
  code: `
    const factorial = (n: number): number => {
      return n <= 1 ? 1 : n * factorial(n - 1)
    }
    
    const result = factorial(10)
    console.log(\`Factorial of 10: \${result}\`)
    result
  `,
  permissions: {},
})

console.log('Status:', result1.status)
if (result1.status === 'success') {
  console.log('Return Value:', result1.returnValue)
}
console.log('Output:', result1.output.join('\n'))
console.log('Execution Time:', `${result1.executionTime.toFixed(2)}ms`)
console.log()

// Example 2: Working with arrays
console.log('2. Array Operations:')
const result2 = await runCode.run({
  code: `
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const sum = numbers.reduce((a, b) => a + b, 0)
    const avg = sum / numbers.length
    
    console.log(\`Sum: \${sum}\`)
    console.log(\`Average: \${avg}\`)
    
    { sum, avg, count: numbers.length }
  `,
  permissions: {},
})

if (result2.status === 'success') {
  const data = JSON.parse(result2.returnValue!)
  console.log('Result:', data)
}
console.log()

// Example 3: Async operations (with network permission)
console.log('3. Async API Call (with network permission):')
const result3 = await runCode.run({
  code: `
    const response = await fetch('https://api.github.com/repos/denoland/deno')
    const data = await response.json()
    
    console.log(\`Repository: \${data.full_name}\`)
    console.log(\`Stars: \${data.stargazers_count}\`)
    console.log(\`Description: \${data.description}\`)
    
    {
      name: data.full_name,
      stars: data.stargazers_count,
      language: data.language
    }
  `,
  permissions: { net: ['api.github.com'] },
  timeout: 10000,
})

if (result3.status === 'success') {
  const data = JSON.parse(result3.returnValue!)
  console.log('Repository Info:', data)
} else {
  console.log('Error:', result3.error)
}
console.log()

// Example 4: String manipulation
console.log('4. String Manipulation:')
const result4 = await runCode.run({
  code: `
    const name = 'Alice';
    const age = 25;
    console.log(\`Hello, \${name}!\`)
    console.log(\`You are \${age} years old.\`)
    
    \`\${name} will be \${age + 10} years old in 10 years\`
  `,
  permissions: {},
})

if (result4.status === 'success') {
  console.log('Result:', result4.returnValue)
}
console.log()

// Example 5: Error handling
console.log('5. Error Handling:')
const result5 = await runCode.run({
  code: `
    // This will fail due to permission denied
    await Deno.readTextFile('/etc/passwd')
  `,
  permissions: {}, // No read permission
})

console.log('Status:', result5.status)
if (result5.status === 'error') {
  console.log('Error Type:', result5.errorType)
  console.log('Error Message:', result5.error.split('\n')[0])
}
console.log()

console.log('=== Examples Complete ===')
