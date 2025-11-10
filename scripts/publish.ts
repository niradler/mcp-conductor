#!/usr/bin/env -S deno run --allow-all

const VERSION_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/

function showHelp() {
  console.log(`
MCP Conductor - NPM Publish Script

USAGE:
  deno task publish <version>

ARGUMENTS:
  version    Semantic version (e.g., 0.1.0, 1.0.0-beta.1)

EXAMPLES:
  deno task publish 0.1.0
  deno task publish 1.0.0-beta.1

This script will:
1. Validate version format
2. Update version in deno.json
3. Build npm package using dnt
4. Run npm publish (dry-run by default)

For actual publishing, run:
  cd npm && npm publish --access public
`)
  Deno.exit(1)
}

async function updateDenoJsonVersion(version: string): Promise<void> {
  const denoJsonPath = 'deno.json'
  const content = await Deno.readTextFile(denoJsonPath)
  const denoJson = JSON.parse(content)

  denoJson.version = version

  await Deno.writeTextFile(denoJsonPath, JSON.stringify(denoJson, null, 2) + '\n')
  console.log(`✅ Updated deno.json version to ${version}`)
}

async function runTests(): Promise<boolean> {
  console.log('🧪 Running tests...')

  const cmd = new Deno.Command('deno', {
    args: ['task', 'test'],
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const { code } = await cmd.output()
  return code === 0
}

async function runBuild(version: string): Promise<boolean> {
  console.log('🔨 Building npm package...')

  const cmd = new Deno.Command('deno', {
    args: ['run', '--allow-all', 'scripts/build_npm.ts', version],
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const { code } = await cmd.output()
  return code === 0
}

async function checkNpmAuth(): Promise<boolean> {
  try {
    const cmd = new Deno.Command('npm', {
      args: ['whoami'],
      stdout: 'piped',
      stderr: 'piped',
    })

    const { code } = await cmd.output()
    return code === 0
  } catch {
    return false
  }
}

async function main() {
  const args = Deno.args

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp()
  }

  const version = args[0]

  if (!VERSION_REGEX.test(version)) {
    console.error(`❌ Invalid version format: ${version}`)
    console.error('Version must follow semantic versioning (e.g., 0.1.0, 1.0.0-beta.1)')
    Deno.exit(1)
  }

  console.log('')
  console.log('========================================')
  console.log(`📦 Publishing MCP Conductor v${version}`)
  console.log('========================================')
  console.log('')

  console.log('1️⃣ Updating version in deno.json...')
  await updateDenoJsonVersion(version)
  console.log('')

  console.log('2️⃣ Running tests...')
  const testsOk = await runTests()
  if (!testsOk) {
    console.error('❌ Tests failed. Aborting publish.')
    Deno.exit(1)
  }
  console.log('✅ All tests passed')
  console.log('')

  console.log('3️⃣ Building npm package...')
  const buildOk = await runBuild(version)
  if (!buildOk) {
    console.error('❌ Build failed. Aborting publish.')
    Deno.exit(1)
  }
  console.log('')

  console.log('4️⃣ Checking npm authentication...')
  const isAuthenticated = await checkNpmAuth()
  if (!isAuthenticated) {
    console.log('⚠️  Not authenticated with npm. Run: npm login')
  } else {
    const cmd = new Deno.Command('npm', {
      args: ['whoami'],
      stdout: 'piped',
    })
    const { stdout } = await cmd.output()
    const username = new TextDecoder().decode(stdout).trim()
    console.log(`✅ Authenticated as: ${username}`)
  }
  console.log('')

  console.log('========================================')
  console.log('✅ Build complete!')
  console.log('========================================')
  console.log('')
  console.log('📋 Next steps:')
  console.log('')
  console.log('  # Dry run (recommended first):')
  console.log('  cd build && npm publish --dry-run')
  console.log('')
  console.log('  # Actual publish:')
  console.log('  cd build && npm publish')
  console.log('')
  console.log('  # Tag git release:')
  console.log(`  git add deno.json`)
  console.log(`  git commit -m "chore: release v${version}"`)
  console.log(`  git tag v${version}`)
  console.log(`  git push && git push --tags`)
  console.log('')
  console.log('📖 Architecture:')
  console.log('  - Node.js wrapper spawns Deno for all execution')
  console.log('  - Deno provides MCP server + secure code sandbox')
  console.log('  - Users need both Node.js and Deno installed')
  console.log('')
}

if (import.meta.main) {
  main()
}
