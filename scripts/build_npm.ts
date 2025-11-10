#!/usr/bin/env -S deno run --allow-all

import * as path from 'jsr:@std/path@^1'
import * as fs from 'jsr:@std/fs@^1'

const VERSION = Deno.args[0] || '0.1.0'
const OUT_DIR = './build'

console.log(`Building MCP Conductor v${VERSION} for npm...`)
console.log('')
console.log('📦 Creating Node.js-compatible package...')
console.log('   - MCP Server: Will run in Node.js')
console.log('   - Code Execution: Will spawn Deno subprocess')
console.log('')

await fs.emptyDir(OUT_DIR)

const packageJson = {
  name: 'mcp-conductor',
  version: VERSION,
  description:
    'Secure Deno code execution for AI agents via Model Context Protocol. MCP server runs in Node.js, spawns Deno for secure code execution.',
  license: 'MIT',
  author: 'Nir Adler',
  type: 'module',
  repository: {
    type: 'git',
    url: 'git+https://github.com/niradler/mcp-conductor.git',
  },
  bugs: {
    url: 'https://github.com/niradler/mcp-conductor/issues',
  },
  homepage: 'https://github.com/niradler/mcp-conductor#readme',
  keywords: [
    'mcp',
    'model-context-protocol',
    'deno',
    'security',
    'sandbox',
    'code-execution',
    'ai',
    'llm',
    'typescript',
    'javascript',
    'anthropic',
    'claude',
  ],
  engines: {
    node: '>=20.0.0',
  },
  bin: {
    'mcp-conductor': './bin/mcp-conductor.js',
  },
  main: './bin/mcp-conductor.js',
  files: [
    'bin/',
    'src/',
    'deno.json',
    'LICENSE',
    'README.md',
  ],
  dependencies: {},
  peerDependencies: {},
}

await Deno.writeTextFile(
  path.join(OUT_DIR, 'package.json'),
  JSON.stringify(packageJson, null, 2) + '\n',
)
console.log('✅ Created package.json')

await Deno.copyFile('LICENSE', path.join(OUT_DIR, 'LICENSE'))
console.log('✅ Copied LICENSE')

await Deno.copyFile('README.md', path.join(OUT_DIR, 'README.md'))
console.log('✅ Copied README.md')

const npmignoreContent = `tests/
coverage/
.cursor/
examples/
.git/
.github/
.vscode/
deno.lock
scripts/
*.test.ts
*.tsbuildinfo
node_modules/
npm/
`

await Deno.writeTextFile(path.join(OUT_DIR, '.npmignore'), npmignoreContent)
console.log('✅ Created .npmignore')

await fs.copy('src', path.join(OUT_DIR, 'src'), { overwrite: true })
console.log('✅ Copied src/ directory')

await Deno.copyFile('deno.json', path.join(OUT_DIR, 'deno.json'))
console.log('✅ Copied deno.json')

console.log('📦 Installing dependencies...')
const installCmd = new Deno.Command('deno', {
  args: ['install'],
  cwd: OUT_DIR,
  stdout: 'inherit',
  stderr: 'inherit',
})
const installResult = await installCmd.output()
if (installResult.code === 0) {
  console.log('✅ Dependencies installed')
} else {
  console.warn('⚠️  Warning: Failed to install dependencies')
}

const binDir = path.join(OUT_DIR, 'bin')
await fs.ensureDir(binDir)

const wrapperScript = `#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const srcPath = join(__dirname, '..', 'src', 'cli', 'cli.ts');

const denoArgs = [
  'run',
  '--no-prompt',
  '--allow-read',
  '--allow-write',
  '--allow-net',
  '--allow-env',
  '--allow-run=deno',
  srcPath,
  ...process.argv.slice(2)
];

const deno = spawn('deno', denoArgs, {
  stdio: 'inherit',
  env: process.env
});

deno.on('exit', (code) => {
  process.exit(code || 0);
});

deno.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('❌ Error: Deno is not installed or not in PATH.');
    console.error('');
    console.error('MCP Conductor requires Deno for secure code execution.');
    console.error('');
    console.error('📥 Install Deno:');
    console.error('   https://docs.deno.com/runtime/getting_started/installation');
    console.error('');
    console.error('💡 Why Deno?');
    console.error('   - Secure sandbox with permission-based security');
    console.error('   - Zero permissions by default');
    console.error('   - Admin-controlled via environment variables');
    console.error('');
    process.exit(1);
  } else {
    console.error('❌ Error launching Deno:', err);
    process.exit(1);
  }
});
`

await Deno.writeTextFile(path.join(binDir, 'mcp-conductor.js'), wrapperScript)
console.log('✅ Created bin/mcp-conductor.js wrapper')

if (Deno.build.os !== 'windows') {
  await Deno.chmod(path.join(binDir, 'mcp-conductor.js'), 0o755)
  console.log('✅ Made wrapper executable')
}

const readmeAddendum = `

---

## NPM Package Information

### Architecture

This npm package provides a **hybrid architecture**:

- **MCP Server Process**: Lightweight Node.js wrapper that handles MCP protocol
- **Code Execution**: Spawns Deno subprocesses for secure sandboxed execution
- **Best of Both Worlds**: Node.js ecosystem compatibility + Deno's security model

### Why This Approach?

1. **Wider Compatibility**: Most users have Node.js installed
2. **Security**: Deno's permission system provides robust sandboxing
3. **Simplicity**: No need to reimplement security features

### Requirements

| Component | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | ≥20.0.0 | Run MCP server |
| **Deno** | ≥2.0.0 | Execute user code securely |

### Installation

\`\`\`bash
# Install globally
npm install -g mcp-conductor

# Or as a project dependency
npm install mcp-conductor
\`\`\`

### Verify Installation

\`\`\`bash
# Check if both are installed
node --version  # Should show v20+
deno --version  # Should show 2.0+

# Test mcp-conductor
mcp-conductor --version
\`\`\`

### Quick Start

\`\`\`bash
# Run MCP server with stdio transport
mcp-conductor stdio

# Run with HTTP transport
mcp-conductor http --port 3001

# Show help
mcp-conductor --help
\`\`\`

### Configuration in Claude Desktop / Cursor

Add to \`.cursor/mcp.json\` or Claude Desktop config:

\`\`\`json
{
  "mcpServers": {
    "mcp-conductor": {
      "command": "mcp-conductor",
      "args": ["stdio"],
      "env": {
        "MCP_CONDUCTOR_WORKSPACE": "\${userHome}/.mcp-conductor/workspace",
        "MCP_CONDUCTOR_RUN_ARGS": "allow-read=\${userHome}/.mcp-conductor/workspace,allow-write=\${userHome}/.mcp-conductor/workspace"
      }
    }
  }
}
\`\`\`

### How It Works

\`\`\`
┌─────────────────────────────────────────┐
│  Node.js Process (MCP Server)          │
│  - Handles MCP protocol                 │
│  - Manages configuration                │
│  - Spawns Deno subprocesses             │
└──────────────┬──────────────────────────┘
               │ spawns
               ▼
┌─────────────────────────────────────────┐
│  Deno Subprocess (Code Execution)       │
│  - Zero permissions by default          │
│  - Admin-controlled via env vars        │
│  - Fresh sandbox per execution          │
│  - Timeout protection                   │
└─────────────────────────────────────────┘
\`\`\`

### Troubleshooting

#### Deno Not Found

If you see "Deno is not installed", install it:

\`\`\`bash
# macOS/Linux
curl -fsSL https://deno.land/install.sh | sh

# Windows (PowerShell)
irm https://deno.land/install.ps1 | iex

# Homebrew
brew install deno

# npm (not recommended for production)
npm install -g deno
\`\`\`

#### Permission Denied

If you see permission errors, check your MCP_CONDUCTOR_RUN_ARGS:

\`\`\`json
{
  "env": {
    "MCP_CONDUCTOR_RUN_ARGS": "allow-read=/your/workspace,allow-write=/your/workspace"
  }
}
\`\`\`

### For Pure Deno Users

If you want to run everything in Deno without Node.js:

\`\`\`bash
# Install from JSR
deno install -n mcp-conductor --allow-all jsr:@conductor/mcp

# Or use directly in deno.json
{
  "imports": {
    "mcp-conductor": "jsr:@conductor/mcp"
  }
}
\`\`\`

### Development

To use this package in development:

\`\`\`bash
git clone https://github.com/niradler/mcp-conductor
cd mcp-conductor
npm link
\`\`\`

### License

MIT - See LICENSE file for details
`

const readmeContent = await Deno.readTextFile(path.join(OUT_DIR, 'README.md'))
await Deno.writeTextFile(
  path.join(OUT_DIR, 'README.md'),
  readmeContent + readmeAddendum,
)
console.log('✅ Updated README with npm-specific documentation')

console.log('')
console.log('========================================')
console.log('✅ Build complete!')
console.log('========================================')
console.log('')
console.log('📋 Package Summary:')
console.log(`   Name: mcp-conductor`)
console.log(`   Version: ${VERSION}`)
console.log(`   License: MIT`)
console.log('')
console.log('🏗️  Architecture:')
console.log('   Node.js wrapper → spawns → Deno sandbox')
console.log('')
console.log('📦 Package Contents:')
console.log('   ├── bin/mcp-conductor.js (entry point)')
console.log('   ├── src/ (TypeScript source)')
console.log('   ├── deno.json (Deno configuration)')
console.log('   ├── package.json')
console.log('   ├── README.md')
console.log('   └── LICENSE')
console.log('')
console.log('✅ Next steps:')
console.log('   1. cd npm')
console.log('   2. npm publish --dry-run  # Test packaging')
console.log('   3. npm publish  # Publish to npm registry')
console.log('')
console.log('🔍 Test locally:')
console.log('   cd npm && npm link')
console.log('   mcp-conductor --version')
console.log('')
