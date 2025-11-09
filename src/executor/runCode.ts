/**
 * Deno code execution engine
 * Executes TypeScript/JavaScript code in an isolated Deno subprocess
 */

import type {
  ExecutionOptions,
  LogHandler,
  RunError,
  RunResult,
  RunSuccess,
} from '../types/types.ts'
import { PermissionBuilder } from './permissions.ts'

/**
 * Manages execution of Deno code in sandboxed subprocesses
 */
export class RunCode {
  private readonly defaultTimeout: number = 30000 // 30 seconds
  private readonly maxTimeout: number = 300000 // 5 minutes
  private readonly defaultRunArgs: string[] = []
  private mcpFactoryCode: string | null = null

  constructor(defaultRunArgs?: string[]) {
    this.defaultRunArgs = defaultRunArgs ?? []
  }

  setMcpFactoryCode(code: string | null): void {
    this.mcpFactoryCode = code
  }

  /**
   * Execute Deno/TypeScript code in a sandboxed subprocess
   *
   * @param options Execution options
   * @param log Optional logging callback
   * @returns Execution result
   */
  async run(
    options: ExecutionOptions,
    log?: LogHandler,
  ): Promise<RunResult> {
    const startTime = performance.now()
    const timeout = Math.min(
      options.timeout ?? this.defaultTimeout,
      this.maxTimeout,
    )

    try {
      let runArgs: string[]

      // Always include --no-prompt for safety
      const noPromptFlag = '--no-prompt'

      // If user specified permissions, use those (override defaults)
      if (options.permissions && Object.keys(options.permissions).length > 0) {
        // Validate permissions
        PermissionBuilder.validate(options.permissions)

        // Build permission flags from user request
        const userPermissions = new PermissionBuilder(options.permissions).build()

        // Combine: always include --no-prompt + user permissions
        runArgs = [noPromptFlag, ...userPermissions]

        log?.('debug', `Using user-specified permissions: ${runArgs.join(' ')}`)
      } else {
        // No user permissions - use defaults from env vars
        const defaultArgs = this.defaultRunArgs.filter((arg) => arg !== noPromptFlag)
        runArgs = [noPromptFlag, ...defaultArgs]

        log?.('debug', `Using default permissions: ${runArgs.join(' ')}`)
      }

      log?.('debug', `Executing code with args: ${runArgs.join(' ')}`)

      // TWO-STEP DEPENDENCY INSTALLATION (Security Model)
      let importMapFile: string | undefined
      let depsDir: string | undefined

      if (options.dependencies && options.dependencies.length > 0) {
        log?.('info', `Installing dependencies: ${options.dependencies.join(', ')}`)

        // Step 1: Install dependencies with write permissions
        const installResult = await this.installDependencies(
          options.dependencies,
          timeout,
          log,
        )

        if (!installResult.success) {
          const executionTime = performance.now() - startTime
          return {
            status: 'error',
            output: installResult.output,
            error: installResult.error,
            errorType: 'runtime',
            executionTime,
          } as RunError
        }

        importMapFile = installResult.importMapFile
        depsDir = installResult.depsDir

        log?.('info', 'Dependencies installed successfully')
      }

      // Create a wrapper script that:
      // 1. Captures the last expression value
      // 2. Handles async code
      // 3. Provides globals
      // 4. Imports dependencies (if any)
      const wrappedCode = this.wrapCode(
        options.code,
        options.globals,
        options.dependencies,
      )

      // Write code to a temporary file
      const tempFile = await this.writeTempFile(wrappedCode)

      try {
        // Step 2: Execute in subprocess with READ-ONLY access to deps
        const result = await this.executeInSubprocess(
          tempFile,
          runArgs,
          timeout,
          options.cwd,
          log,
          importMapFile,
        )

        const executionTime = performance.now() - startTime

        if (result.success) {
          return {
            status: 'success',
            output: result.output,
            returnValue: result.returnValue,
            executionTime,
          } as RunSuccess
        } else {
          return {
            status: 'error',
            output: result.output,
            error: result.error,
            errorType: result.errorType,
            executionTime,
          } as RunError
        }
      } finally {
        // Clean up temp files
        await this.deleteTempFile(tempFile)
        if (importMapFile) {
          await this.deleteTempFile(importMapFile)
        }
        if (depsDir) {
          try {
            await Deno.remove(depsDir, { recursive: true })
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    } catch (error) {
      const executionTime = performance.now() - startTime
      log?.('error', `Execution failed: ${error}`)

      return {
        status: 'error',
        output: [],
        error: error instanceof Error ? error.message : String(error),
        errorType: 'runtime',
        executionTime,
      } as RunError
    }
  }

  /**
   * Wrap user code to capture return value and handle async
   */
  private wrapCode(
    code: string,
    globals?: Record<string, unknown>,
    _dependencies?: string[],
  ): string {
    const mcpFactoryInjection = this.mcpFactoryCode
      ? `try {\n${this.mcpFactoryCode}\n} catch (e) {\n  console.error('Failed to initialize MCP factory:', e);\n}\n\n`
      : ''

    const globalsCode = globals
      ? Object.entries(globals)
        .map(([key, value]) => `const ${key} = ${JSON.stringify(value)};`)
        .join('\n')
      : ''

    const trimmedCode = code.trim()

    // Check if code contains imports/exports (ES module syntax)
    const hasImports = /^\s*import\s/m.test(trimmedCode) || /^\s*export\s/m.test(trimmedCode)

    // If code has imports, treat it as a module and don't wrap in IIFE
    if (hasImports) {
      // For modules with imports/exports, we need to wrap in async function
      // because top-level return is not allowed in modules
      const lines = trimmedCode.split('\n')
      const lastLine = lines[lines.length - 1].trim()

      // Check if last line is a return statement
      if (lastLine.startsWith('return ')) {
        // Remove return and treat as expression
        const valueExpr = lastLine.substring(7).trim() // Remove 'return '
        const precedingLines = lines.slice(0, -1).join('\n')
        return `
// MCP Run Deno - Module Execution
${mcpFactoryInjection}${globalsCode}

${precedingLines}

// Capture return value
const __mcpRunDenoResult = ${valueExpr}

// Serialize and output result
if (__mcpRunDenoResult !== undefined) {
  try {
    console.log('__MCP_RETURN_VALUE__:' + JSON.stringify(__mcpRunDenoResult));
  } catch (e) {
    console.log('__MCP_RETURN_VALUE__:[Non-serializable value]');
  }
}
`
      }

      const isLikelyExpression = lastLine &&
        !lastLine.startsWith('const ') &&
        !lastLine.startsWith('let ') &&
        !lastLine.startsWith('var ') &&
        !lastLine.startsWith('function ') &&
        !lastLine.startsWith('class ') &&
        !lastLine.startsWith('if ') &&
        !lastLine.startsWith('for ') &&
        !lastLine.startsWith('while ') &&
        !lastLine.startsWith('throw ') &&
        !lastLine.startsWith('return ') &&
        !lastLine.startsWith('import ') &&
        !lastLine.startsWith('export ') &&
        !lastLine.endsWith('{') &&
        !lastLine.endsWith('}') &&
        !lastLine.endsWith(';')

      if (isLikelyExpression) {
        const precedingLines = lines.slice(0, -1).join('\n')
        return `
// MCP Run Deno - Module Execution
${mcpFactoryInjection}${globalsCode}

${precedingLines}

// Capture last expression
const __mcpRunDenoResult = ${lastLine};

// Serialize and output result
if (__mcpRunDenoResult !== undefined) {
  try {
    console.log('__MCP_RETURN_VALUE__:' + JSON.stringify(__mcpRunDenoResult));
  } catch (e) {
    console.log('__MCP_RETURN_VALUE__:[Non-serializable value]');
  }
}
`
      } else {
        // No clear return value, just run the code
        return `
// MCP Run Deno - Module Execution
${mcpFactoryInjection}${globalsCode}

${trimmedCode}
`
      }
    }

    // Non-module code: wrap in async IIFE as before
    const lastSemicolon = trimmedCode.lastIndexOf(';')
    const hasTrailingExpression = lastSemicolon !== -1 && lastSemicolon < trimmedCode.length - 1

    let wrappedCode: string
    if (hasTrailingExpression) {
      const statementsBeforeLast = trimmedCode.substring(0, lastSemicolon + 1)
      const lastExpression = trimmedCode.substring(lastSemicolon + 1).trim()
      wrappedCode = `${statementsBeforeLast}\nreturn ${lastExpression}`
    } else {
      const lines = trimmedCode.split('\n')
      const lastLine = lines[lines.length - 1].trim()
      const precedingLines = lines.slice(0, -1).join('\n')

      const isLikelyExpression = lastLine &&
        !lastLine.startsWith('const ') &&
        !lastLine.startsWith('let ') &&
        !lastLine.startsWith('var ') &&
        !lastLine.startsWith('function ') &&
        !lastLine.startsWith('class ') &&
        !lastLine.startsWith('if ') &&
        !lastLine.startsWith('for ') &&
        !lastLine.startsWith('while ') &&
        !lastLine.startsWith('throw ') &&
        !lastLine.startsWith('return ') &&
        !lastLine.endsWith('{') &&
        !lastLine.endsWith('}') &&
        !lastLine.endsWith(';')

      wrappedCode = isLikelyExpression && precedingLines
        ? `${precedingLines}\nreturn ${lastLine}`
        : isLikelyExpression
        ? `return ${lastLine}`
        : trimmedCode
    }

    return `
// MCP Run Deno - Execution Wrapper
${mcpFactoryInjection}${globalsCode}

// User code wrapped in async IIFE
const __mcpRunDenoResult = await (async () => {
${wrappedCode}
})();

// Serialize and output result
if (__mcpRunDenoResult !== undefined) {
  try {
    console.log('__MCP_RETURN_VALUE__:' + JSON.stringify(__mcpRunDenoResult));
  } catch (e) {
    console.log('__MCP_RETURN_VALUE__:[Non-serializable value]');
  }
}
`
  }

  /**
   * Install dependencies in isolated environment
   * Step 1 of two-step security model: install with write permissions
   */
  private async installDependencies(
    dependencies: string[],
    timeout: number,
    log?: LogHandler,
  ): Promise<{
    success: boolean
    importMapFile?: string
    depsDir?: string
    output: string[]
    error: string
  }> {
    const output: string[] = []

    try {
      // Create temp directory for dependencies
      const depsDir = await Deno.makeTempDir({ prefix: 'mcp-deno-deps-' })

      // Create import map
      const importMap = {
        imports: Object.fromEntries(
          dependencies.map((dep) => {
            // Extract package name from npm:package@version or jsr:@scope/package
            const name = dep.replace(/^(npm:|jsr:)(@?[\w-]+\/)?/, '').split('@')[0]
            return [name, dep]
          }),
        ),
      }

      const importMapFile = `${depsDir}/import_map.json`
      await Deno.writeTextFile(importMapFile, JSON.stringify(importMap, null, 2))

      // Create a simple script to trigger dependency installation
      const installScript = `${depsDir}/install.ts`
      const importStatements = dependencies.map((dep, i) => `import dep${i} from '${dep}';`).join(
        '\n',
      )
      await Deno.writeTextFile(
        installScript,
        importStatements + '\nconsole.log("Dependencies installed");',
      )

      // Run with write permissions to cache dependencies
      const cmd = new Deno.Command('deno', {
        args: [
          'run',
          '--no-prompt',
          '--allow-read',
          '--allow-write',
          '--allow-net',
          '--import-map',
          importMapFile,
          installScript,
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: depsDir,
      })

      log?.('debug', 'Installing dependencies...')

      const process = cmd.spawn()
      const timeoutId = setTimeout(() => {
        process.kill('SIGTERM')
      }, timeout)

      const [stdoutData, stderrData, status] = await Promise.all([
        this.readStream(process.stdout.getReader(), new TextDecoder()),
        this.readStream(process.stderr.getReader(), new TextDecoder()),
        process.status,
      ])

      clearTimeout(timeoutId)

      output.push(...stdoutData, ...stderrData)

      if (status.code !== 0) {
        return {
          success: false,
          output,
          error: `Dependency installation failed: ${stderrData.join('\n')}`,
        }
      }

      return {
        success: true,
        importMapFile,
        depsDir,
        output,
        error: '',
      }
    } catch (error) {
      return {
        success: false,
        output,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Execute code in a Deno subprocess
   * Step 2 of two-step security model: execute with read-only access
   */
  private async executeInSubprocess(
    scriptPath: string,
    permissionFlags: string[],
    timeout: number,
    cwd?: string,
    log?: LogHandler,
    importMapFile?: string,
  ): Promise<{
    success: boolean
    output: string[]
    returnValue: string | null
    error: string
    errorType: 'syntax' | 'runtime' | 'timeout' | 'permission'
  }> {
    const output: string[] = []
    let returnValue: string | null = null
    let success = true
    let error = ''
    let errorType: 'syntax' | 'runtime' | 'timeout' | 'permission' = 'runtime'

    // Build command with import map if dependencies were installed
    const args = ['run', ...permissionFlags]
    if (importMapFile) {
      args.push('--import-map', importMapFile)
    }
    args.push(scriptPath)

    const cmd = new Deno.Command('deno', {
      args,
      stdout: 'piped',
      stderr: 'piped',
      cwd: cwd,
    })

    // Spawn subprocess
    const process = cmd.spawn()

    // Set up timeout
    const timeoutId = setTimeout(() => {
      process.kill('SIGTERM')
      success = false
      error = `Execution timed out after ${timeout}ms`
      errorType = 'timeout'
    }, timeout)

    try {
      // Read stdout
      const stdoutReader = process.stdout.getReader()
      const stderrReader = process.stderr.getReader()
      const decoder = new TextDecoder()

      // Read streams concurrently
      const [stdoutData, stderrData, status] = await Promise.all([
        this.readStream(stdoutReader, decoder),
        this.readStream(stderrReader, decoder),
        process.status,
      ])

      clearTimeout(timeoutId)

      // Process stdout - extract return value marker
      for (const line of stdoutData) {
        if (line.startsWith('__MCP_RETURN_VALUE__:')) {
          returnValue = line.substring('__MCP_RETURN_VALUE__:'.length)
        } else {
          output.push(line)
          log?.('info', line)
        }
      }

      // Process stderr
      for (const line of stderrData) {
        output.push(line)
        log?.('warning', line)
      }

      // Check exit status
      if (status.code !== 0 && success) {
        success = false
        error = stderrData.join('\n') || `Process exited with code ${status.code}`

        // Determine error type from error message
        if (
          error.includes('could not be parsed') || error.includes('Unexpected token') ||
          error.includes('SyntaxError') || error.includes('Parse error')
        ) {
          errorType = 'syntax'
        } else if (
          error.includes('NotCapable') || error.includes('Requires') ||
          error.includes('PermissionDenied') || error.includes('--allow-')
        ) {
          errorType = 'permission'
        } else {
          errorType = 'runtime'
        }
      }

      return {
        success,
        output,
        returnValue,
        error,
        errorType,
      }
    } catch (err) {
      clearTimeout(timeoutId)
      return {
        success: false,
        output,
        returnValue: null,
        error: err instanceof Error ? err.message : String(err),
        errorType: 'runtime',
      }
    }
  }

  /**
   * Read a stream into an array of lines
   */
  private async readStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
  ): Promise<string[]> {
    const lines: string[] = []
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const newLines = buffer.split('\n')
        buffer = newLines.pop() || ''

        for (const line of newLines) {
          if (line.trim()) {
            lines.push(line)
          }
        }
      }

      // Add remaining buffer
      if (buffer.trim()) {
        lines.push(buffer)
      }
    } finally {
      reader.releaseLock()
    }

    return lines
  }

  /**
   * Write code to a temporary file
   */
  private async writeTempFile(code: string): Promise<string> {
    const tempDir = await Deno.makeTempDir({ prefix: 'mcp-run-deno-' })
    const tempFile = `${tempDir}/script.ts`
    await Deno.writeTextFile(tempFile, code)
    return tempFile
  }

  /**
   * Delete temporary file and directory
   */
  private async deleteTempFile(path: string): Promise<void> {
    try {
      const dir = path.substring(0, path.lastIndexOf('/'))
      await Deno.remove(dir, { recursive: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Format result as XML (for LLM-friendly output)
 */
export function asXml(result: RunResult): string {
  const xml: string[] = [`<status>${result.status}</status>`]

  if (result.output.length > 0) {
    xml.push('<output>')
    xml.push(...result.output.map(escapeXml))
    xml.push('</output>')
  }

  if (result.status === 'success') {
    if (result.returnValue) {
      xml.push('<return_value>')
      xml.push(escapeXml(result.returnValue))
      xml.push('</return_value>')
    }
  } else {
    xml.push('<error>')
    xml.push(`<type>${result.errorType}</type>`)
    xml.push(`<message>${escapeXml(result.error)}</message>`)
    xml.push('</error>')
  }

  xml.push(`<execution_time>${result.executionTime.toFixed(2)}ms</execution_time>`)

  return xml.join('\n')
}

/**
 * Format result as JSON
 */
export function asJson(result: RunResult): string {
  if (result.status === 'success') {
    return JSON.stringify({
      status: result.status,
      output: result.output,
      returnValue: result.returnValue ? JSON.parse(result.returnValue) : null,
      executionTime: result.executionTime,
    })
  } else {
    return JSON.stringify({
      status: result.status,
      output: result.output,
      error: result.error,
      errorType: result.errorType,
      executionTime: result.executionTime,
    })
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
