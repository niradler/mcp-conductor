# Default Playbooks

This directory contains the **source of truth** for default/system playbooks that ship with MCP
Conductor.

## How It Works

1. **Edit playbooks here** - All default playbooks live in this `playbooks/` directory
2. **Mark as system** - Ensure `source: system` in the YAML frontmatter
3. **Auto-copy on boot** - MCP Conductor copies them to user's playbook directory on startup
4. **Always updated** - System playbooks are refreshed on every restart

## Creating a New Default Playbook

### 1. Create the playbook folder

```bash
mkdir playbooks/my-new-playbook
```

### 2. Create playbook.md (required)

```markdown
---
name: My New Playbook
description: What this playbook does and when to use it. This playbook should be used when...
author: Your Name
version: 1.0.0
tags:
  - category
  - keywords
source: system # ← IMPORTANT: Mark as system playbook
---

# My New Playbook

Documentation here...

## Usage

\`\`\`typescript const { myFunction } = await importPlaybook('my-new-playbook'); \`\`\`
```

### 3. Create playbook.ts (optional)

```typescript
export function myFunction() {
  // Your reusable code here
}
```

### 4. Test it

Restart MCP Conductor and run:

```typescript
// Should list your new playbook
await list_playbooks()

// Should be able to import it
const { myFunction } = await importPlaybook('my-new-playbook')
```

## System vs User Playbooks

### System Playbooks (`source: system`)

- ✅ **Auto-updated** - Overwritten on every MCP Conductor restart
- ✅ **Bundled** - Embedded in the code, work when installed from JSR
- ✅ **Versioned** - Part of the MCP Conductor codebase
- ✅ **Quality-controlled** - Reviewed and tested

**Use for:** High-quality, reusable utilities that everyone should have

### User Playbooks (`source: user`)

- ✅ **Protected** - Never overwritten by system updates
- ✅ **Custom** - User-specific or project-specific code
- ✅ **Flexible** - Can be modified freely

**Use for:** Personal utilities, project-specific code, experiments

## Current Default Playbooks

### http-utilities

Reusable HTTP utilities with automatic retries, timeout handling, and error recovery.

**Features:**

- `fetchWithRetry()` - Fetch with automatic retries and exponential backoff
- `fetchJSON()` - Fetch and parse JSON with error handling

### playbook-creator

Comprehensive guide for creating effective playbooks.

**Teaches:**

- Playbook anatomy and structure
- Step-by-step creation process
- Design patterns and best practices
- Common mistakes to avoid

### mcp-conductor-guide

Complete usage guide for MCP Conductor.

**Covers:**

- Core capabilities and configuration
- Performance best practices
- Security principles
- Advanced patterns
- Tips and tricks

## Publishing

The `playbooks/` directory is included in JSR/NPM packages (see `deno.json` publish config). System
playbooks are automatically copied to user directories on first boot.

## Best Practices

### ✅ Do

- Keep playbooks focused on one domain
- Include complete examples in documentation
- Use TypeScript types in code
- Test playbooks before committing
- Update version numbers when making changes

### ❌ Don't

- Don't embed large assets (images, binaries)
- Don't include environment-specific paths
- Don't use `source: user` for shared playbooks
- Don't commit without testing

## Workflow Summary

```
1. Edit playbooks/my-playbook/playbook.md
2. Test locally (restart MCP Conductor)
3. Commit the changes
4. Users get updated playbooks on restart
```

## File Structure

```
playbooks/
├── README.md                    # This file
├── http-utilities/
│   ├── playbook.md              # Documentation (source: system)
│   └── playbook.ts              # Code
├── playbook-creator/
│   └── playbook.md              # Documentation (source: system)
└── mcp-conductor-guide/
    └── playbook.md              # Documentation (source: system)
```

## Questions?

If you're adding a playbook:

1. Is it generally useful? → Make it `source: system`
2. Is it specific to your workflow? → Keep it `source: user` (don't add here)
3. Not sure? → Start as `source: user`, promote later if valuable

## Maintenance

After editing any default playbook:

```bash
# Format
deno fmt

# Verify type safety
deno check src/**/*.ts

# Run tests
deno task test

# Test playbook installation
deno run --allow-read --allow-write --allow-env src/cli/cli.ts
```
