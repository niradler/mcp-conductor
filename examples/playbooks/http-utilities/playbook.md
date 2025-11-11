---
name: HTTP Utilities
description: Common HTTP request patterns with error handling, retries, and timeouts
author: MCP Conductor
version: 1.0.0
tags:
  - http
  - fetch
  - utilities
---

# HTTP Utilities Playbook

Reusable HTTP request utilities with built-in error handling, retries, and timeout support.

## Features

- Automatic retries with exponential backoff
- Configurable timeouts
- Error handling and logging
- JSON and text response parsing

## Usage

Import utilities from this playbook:

```typescript
// Easy import using the helper function
const { fetchWithRetry, fetchJSON } = await importPlaybook('http-utilities')

// Fetch JSON with automatic retries
const data = await fetchJSON('https://api.example.com/data', {
  retries: 3,
  timeout: 5000,
})

// Fetch with custom retry logic
const response = await fetchWithRetry('https://api.example.com/endpoint', {
  retries: 5,
  retryDelay: 1000,
  timeout: 10000,
  method: 'POST',
  body: JSON.stringify({ key: 'value' }),
})
```

## API Reference

### fetchWithRetry(url, options)

Fetch with automatic retry on failure.

**Parameters:**

- `url` (string): URL to fetch
- `options` (object):
  - `retries` (number): Number of retry attempts (default: 3)
  - `retryDelay` (number): Initial delay between retries in ms (default: 1000)
  - `timeout` (number): Request timeout in ms (default: 30000)
  - ...standard fetch options

**Returns:** Promise<Response>

### fetchJSON(url, options)

Fetch and parse JSON response with retries.

**Parameters:**

- Same as `fetchWithRetry`

**Returns:** Promise<any> (parsed JSON)

## Examples

### Simple GET request with retries

```typescript
const { fetchJSON } = await importPlaybook('http-utilities')

const repos = await fetchJSON('https://api.github.com/users/denoland/repos')
console.log(`Found ${repos.length} repositories`)
```

### POST request with timeout

```typescript
const { fetchWithRetry } = await importPlaybook('http-utilities')

const response = await fetchWithRetry('https://api.example.com/submit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: 'value' }),
  timeout: 5000,
  retries: 2,
})

const result = await response.json()
```

## Notes

- This playbook uses Deno's built-in `fetch` API
- Retries use exponential backoff (delay doubles each retry)
- Timeouts are implemented using AbortController
- All packages/imports are handled automatically by Deno
