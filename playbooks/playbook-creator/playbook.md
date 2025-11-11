---
name: Playbook Creator
description: Guide for creating effective playbooks. This playbook should be used when users want to create a new playbook (or update an existing playbook) that extends the LLM's capabilities with specialized knowledge, reusable code utilities, or domain expertise.
author: MCP Conductor Team
version: 1.0.0
tags:
  - meta
  - documentation
  - guide
source: system
---

# Playbook Creator

This playbook provides guidance for creating effective playbooks in MCP Conductor.

## About Playbooks

Playbooks are modular, self-contained packages that extend the LLM's capabilities by providing
specialized knowledge and reusable TypeScript utilities. Think of them as "specialized toolkits" for
specific domains or tasks—they transform the LLM from a general-purpose agent into a specialized
agent equipped with domain-specific code and procedural knowledge.

### What Playbooks Provide

1. **Reusable Code Utilities** - TypeScript functions that can be imported and used in any execution
2. **Domain Expertise** - Specialized knowledge, patterns, and best practices for specific domains
3. **Procedural Knowledge** - Step-by-step workflows and implementation guides
4. **Token Efficiency** - Write once, import anywhere—no need to rewrite common patterns

### Anatomy of a Playbook

Every playbook consists of two files in a dedicated folder:

```
~/.mcp-conductor/playbooks/
└── playbook-name/
    ├── playbook.md     (required) - Documentation with YAML frontmatter
    └── playbook.ts     (optional) - Executable TypeScript code
```

#### playbook.md (Required)

The documentation file with two parts:

1. **YAML Frontmatter** (required):
   - `name`: Display name (required)
   - `description`: When to use this playbook (required)
   - `author`: Creator name (optional)
   - `version`: Version string (optional)
   - `tags`: Categorization tags (optional)

2. **Markdown Body** (required):
   - Overview and purpose
   - Usage instructions with import examples
   - API reference (if playbook.ts exists)
   - Complete examples
   - Best practices and tips

**Metadata Quality:** The `description` determines when the LLM will use the playbook. Be specific
about what it does and when to use it. Use third-person (e.g., "This playbook should be used
when..." not "Use this playbook when...").

#### playbook.ts (Optional)

TypeScript code that exports reusable functions. The code:

- Uses standard Deno APIs and npm/jsr packages
- Exports functions using ES module syntax
- Includes TypeScript types for better DX
- Runs in the same sandbox as user code
- Has access to the same permissions

## Playbook Creation Process

Follow this process in order when creating a playbook:

### Step 1: Understanding the Use Case with Concrete Examples

Before creating a playbook, clearly understand concrete examples of how it will be used.

**Example Questions:**

- "What functionality should this playbook support?"
- "Can you give examples of how this playbook would be used?"
- "What would trigger the LLM to use this playbook?"
- "What code patterns are you writing repeatedly?"

**Example Scenarios:**

_When building an http-utilities playbook:_

- "I keep writing the same fetch retry logic"
- "I need timeout handling for API calls"
- "I want JSON fetching with error handling"

_When building a data-validation playbook:_

- "I validate emails repeatedly"
- "I need URL validation"
- "I check date formats often"

Conclude this step when you have 3-5 concrete examples of the playbook in action.

### Step 2: Planning Reusable Functions

Analyze each example to identify reusable TypeScript functions:

**Example: HTTP Utilities**

- Repeated pattern: Fetch with retries
- Solution: `fetchWithRetry()` function
- Repeated pattern: Parse JSON with error handling
- Solution: `fetchJSON()` function

**Example: Data Validation**

- Repeated pattern: Email validation
- Solution: `validateEmail()` function
- Repeated pattern: URL validation
- Solution: `validateURL()` function

Create a list of functions to export from `playbook.ts`.

### Step 3: Creating the Playbook

Use the `create_playbook` tool to initialize the playbook:

```typescript
// Example: Creating the playbook structure
{
  folder_name: 'data-validation',
  name: 'Data Validation Utilities',
  description: 'Common data validation patterns for emails, URLs, dates, and phone numbers. This playbook should be used when input validation is needed.',
  author: 'Your Name',
  version: '1.0.0',
  tags: ['validation', 'utilities', 'data'],
  content: `[Markdown content - see Step 4]`,
  code: `[TypeScript code - see Step 4]`
}
```

### Step 4: Writing the Playbook

#### A. Write playbook.ts First

Start with the code since it defines the API:

```typescript
// playbook.ts - Example structure
/**
 * Validate an email address
 * @param email - Email address to validate
 * @returns true if valid, false otherwise
 */
export function validateEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return regex.test(email)
}

/**
 * Validate a URL
 * @param url - URL to validate
 * @returns true if valid, false otherwise
 */
export function validateURL(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

// Export a default object for convenience
export default {
  validateEmail,
  validateURL,
}
```

**Code Best Practices:**

- Include JSDoc comments for all exports
- Use TypeScript types (not `any` or `unknown` unless necessary)
- Handle errors gracefully with try/catch
- Keep functions focused and single-purpose
- Export both named exports and a default object

#### B. Write playbook.md Second

Document how to use the code:

````markdown
---
name: Data Validation Utilities
description: Common data validation patterns for emails, URLs, dates, and phone numbers. This playbook should be used when input validation is needed.
author: Your Name
version: 1.0.0
tags:
  - validation
  - utilities
  - data
---

# Data Validation Utilities

Reusable validation functions for common data types.

## Features

- Email validation with RFC 5322 compliance
- URL validation with protocol checking
- Zero dependencies (uses native APIs)
- TypeScript types included

## Usage

Import validation functions from this playbook:

```typescript
const { validateEmail, validateURL } = await importPlaybook('data-validation')

// Validate an email
if (validateEmail('user@example.com')) {
  console.log('Valid email')
}

// Validate a URL
if (validateURL('https://example.com')) {
  console.log('Valid URL')
}
```

## API Reference

### `validateEmail(email: string): boolean`

Validates an email address using RFC 5322 pattern.

**Parameters:**

- `email`: Email address to validate

**Returns:** `true` if valid, `false` otherwise

**Example:**

```typescript
validateEmail('user@example.com') // true
validateEmail('invalid-email') // false
```

### `validateURL(url: string): boolean`

Validates a URL using the native URL constructor.

**Parameters:**

- `url`: URL string to validate

**Returns:** `true` if valid, `false` otherwise

**Example:**

```typescript
validateURL('https://example.com') // true
validateURL('not-a-url') // false
```

## Complete Example

```typescript
const { validateEmail, validateURL } = await importPlaybook('data-validation')

const formData = {
  email: 'user@example.com',
  website: 'https://example.com',
}

const errors = []

if (!validateEmail(formData.email)) {
  errors.push('Invalid email address')
}

if (!validateURL(formData.website)) {
  errors.push('Invalid website URL')
}

if (errors.length > 0) {
  return { success: false, errors }
}

return { success: true, message: 'All data validated' }
```

## Best Practices

- Always validate user input before processing
- Combine multiple validations for complex data
- Return structured error messages for better UX
- Use TypeScript types to catch errors early
````

**Documentation Best Practices:**

- Use imperative/infinitive form (verb-first instructions)
- Include a complete working example
- Document all exported functions with parameters and returns
- Show common patterns and use cases
- Keep it concise but comprehensive

### Step 5: Testing the Playbook

Test the playbook with real code execution:

```typescript
// Test import and basic functionality
const { validateEmail, validateURL } = await importPlaybook('data-validation')

const tests = [
  { name: 'Valid email', fn: () => validateEmail('test@example.com'), expect: true },
  { name: 'Invalid email', fn: () => validateEmail('invalid'), expect: false },
  { name: 'Valid URL', fn: () => validateURL('https://example.com'), expect: true },
  { name: 'Invalid URL', fn: () => validateURL('not-a-url'), expect: false },
]

const results = tests.map((test) => ({
  name: test.name,
  passed: test.fn() === test.expect,
}))

return { results, allPassed: results.every((r) => r.passed) }
```

If tests fail, iterate on the code and documentation.

### Step 6: Iterate and Improve

After using the playbook in real scenarios:

1. Notice what's missing or unclear
2. Identify new functions that would be helpful
3. Update documentation with discovered patterns
4. Add edge cases to existing functions
5. Improve error messages and type safety

**Iteration Workflow:**

1. Use the playbook in real tasks
2. Notice struggles or inefficiencies
3. Update code or documentation
4. Test changes
5. Repeat

## Playbook Design Patterns

### Pattern 1: Utility Functions

Simple, focused functions for common operations:

```typescript
export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount)
}
```

**When to use:** Repeated transformations, formatting, or calculations

### Pattern 2: Wrapper Functions

Simplify complex APIs with sensible defaults:

```typescript
export async function fetchJSON<T = unknown>(
  url: string,
  options: { retries?: number; timeout?: number } = {},
): Promise<T> {
  const { retries = 3, timeout = 10000 } = options
  // Implementation with retry logic and timeout
}
```

**When to use:** APIs that require boilerplate or configuration

### Pattern 3: Builder Patterns

Fluent interfaces for complex operations:

```typescript
export class QueryBuilder {
  private conditions: string[] = []

  where(field: string, value: unknown): this {
    this.conditions.push(`${field} = ${value}`)
    return this
  }

  build(): string {
    return `SELECT * WHERE ${this.conditions.join(' AND ')}`
  }
}
```

**When to use:** Complex configurations or multi-step processes

### Pattern 4: Domain-Specific Tools

Specialized utilities for specific domains:

```typescript
// Example: Git utilities
export async function getCurrentBranch(): Promise<string> {
  const cmd = new Deno.Command('git', { args: ['branch', '--show-current'] })
  const output = await cmd.output()
  return new TextDecoder().decode(output.stdout).trim()
}
```

**When to use:** Domain-specific workflows or tool integrations

## Common Mistakes to Avoid

❌ **Too Generic** - "Utilities" is not specific enough ✅ **Specific Domain** - "HTTP Utilities" or
"Date Formatting"

❌ **Missing Examples** - Documentation without usage examples ✅ **Complete Examples** - Show
imports, usage, and expected results

❌ **Using `any` Types** - Loses TypeScript benefits ✅ **Proper Types** - Use generics or specific
types

❌ **No Error Handling** - Functions that throw on invalid input ✅ **Graceful Errors** - Return
error objects or use try/catch

❌ **Too Complex** - 500+ line functions doing everything ✅ **Focused Functions** - Small,
composable, single-purpose

❌ **Poor Naming** - `doStuff()`, `handler()`, `process()` ✅ **Clear Naming** - `fetchWithRetry()`,
`validateEmail()`, `formatDate()`

## Quick Reference

**Creating a Playbook:**

```typescript
// Use create_playbook tool
{
  folder_name: 'kebab-case-name',
  name: 'Display Name',
  description: 'Specific description with usage trigger. This playbook should be used when...',
  content: '# Markdown documentation...',
  code: 'export function...'
}
```

**Using a Playbook:**

```typescript
// Import and use
const { functionName } = await importPlaybook('playbook-name')
const result = await functionName(params)
```

**Discovering Playbooks:**

- Use `list_playbooks` tool to see all available playbooks
- Use `get_playbook` tool to read full documentation

## Summary

Good playbooks are:

- **Focused** - Solve one domain well
- **Reusable** - Functions that work in many contexts
- **Well-Documented** - Clear examples and API references
- **Type-Safe** - Use TypeScript types properly
- **Tested** - Proven to work in real scenarios
- **Maintained** - Updated based on usage feedback

Remember: A playbook is successful when it eliminates repeated code and makes common tasks easier!
