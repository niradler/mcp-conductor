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
  private readonly defaultTimeout: number = 30000
  private readonly maxTimeout: number = 300000
  private readonly maxReturnSize: number = 262144
  private readonly defaultRunArgs: string[] = []
  private readonly workspaceDir: string
  private mcpFactoryCode: string | null = null

  constructor(defaultRunArgs?: string[], workspaceDir?: string, maxReturnSize?: number) {
    this.defaultRunArgs = defaultRunArgs ?? []
    this.workspaceDir = workspaceDir ?? Deno.cwd()
    this.maxReturnSize = maxReturnSize ?? 262144
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
      const noPromptFlag = '--no-prompt'

      if (options.permissions && Object.keys(options.permissions).length > 0) {
        PermissionBuilder.validate(options.permissions)
        const userPermissions = new PermissionBuilder(options.permissions).build()
        runArgs = [noPromptFlag, ...userPermissions]
        log?.('debug', `Using user-specified permissions: ${runArgs.join(' ')}`)
      } else {
        const defaultArgs = this.defaultRunArgs.filter((arg) => arg !== noPromptFlag)
        runArgs = [noPromptFlag, ...defaultArgs]
        log?.('debug', `Using default permissions: ${runArgs.join(' ')}`)
      }

      log?.('debug', `Executing code with args: ${runArgs.join(' ')}`)

      const wrappedCode = this.wrapCode(options.code)
      const tempFile = await this.writeTempFile(wrappedCode)

      try {
        const result = await this.executeInSubprocess(
          tempFile,
          runArgs,
          timeout,
          options.cwd ?? this.workspaceDir,
          log,
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
        await this.deleteTempFile(tempFile)
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
  private wrapCode(code: string): string {
    const mcpFactoryInjection = this.mcpFactoryCode
      ? `try {\n${this.mcpFactoryCode}\n} catch (e) {\n  console.error('Failed to initialize MCP factory:', e);\n}\n\n`
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
        const valueExpr = lastLine.substring(7).trim()
        const precedingLines = lines.slice(0, -1).join('\n')
        return `
// MCP Run Deno - Module Execution
${mcpFactoryInjection}
${precedingLines}

const __mcpRunDenoResult = ${valueExpr}

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
${mcpFactoryInjection}
${precedingLines}

const __mcpRunDenoResult = ${lastLine};

if (__mcpRunDenoResult !== undefined) {
  try {
    console.log('__MCP_RETURN_VALUE__:' + JSON.stringify(__mcpRunDenoResult));
  } catch (e) {
    console.log('__MCP_RETURN_VALUE__:[Non-serializable value]');
  }
}
`
      } else {
        return `
// MCP Run Deno - Module Execution
${mcpFactoryInjection}
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
${mcpFactoryInjection}
const __mcpRunDenoResult = await (async () => {
${wrappedCode}
})();

if (__mcpRunDenoResult !== undefined) {
  try {
    console.log('__MCP_RETURN_VALUE__:' + JSON.stringify(__mcpRunDenoResult));
  } catch (e) {
    console.log('__MCP_RETURN_VALUE__:[Non-serializable value]');
  }
}
`
  }

  private async executeInSubprocess(
    scriptPath: string,
    permissionFlags: string[],
    timeout: number,
    cwd: string,
    log?: LogHandler,
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

    const args = ['run', ...permissionFlags]

    const denoJsonPath = `${cwd}/deno.json`
    try {
      await Deno.stat(denoJsonPath)
      args.push('--config', denoJsonPath)
      log?.('debug', `Using config: ${denoJsonPath}`)
    } catch {
      // No deno.json, continue without it
    }

    args.push(scriptPath)

    const cmd = new Deno.Command('deno', {
      args,
      stdout: 'piped',
      stderr: 'piped',
      cwd,
    })

    const process = cmd.spawn()

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
export async function asXml(
  result: RunResult,
  workspaceDir?: string,
  maxReturnSize?: number,
): Promise<string> {
  const xml: string[] = [`<status>${result.status}</status>`]

  if (result.output.length > 0) {
    xml.push('<output>')
    xml.push(...result.output.map(escapeXml))
    xml.push('</output>')
  }

  if (result.status === 'success') {
    if (result.returnValue) {
      const returnValueSize = new TextEncoder().encode(result.returnValue).length
      const maxSize = maxReturnSize ?? 102400

      if (returnValueSize > maxSize) {
        const savedPath = await saveReturnValueToFile(result.returnValue, workspaceDir)
        xml.push('<return_value>')
        xml.push(
          escapeXml(`[Large output (${formatBytes(returnValueSize)}) saved to file: ${savedPath}]`),
        )
        xml.push('</return_value>')
        xml.push('<return_value_file>')
        xml.push(escapeXml(savedPath))
        xml.push('</return_value_file>')
      } else {
        xml.push('<return_value>')
        xml.push(escapeXml(result.returnValue))
        xml.push('</return_value>')
      }
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
 * Save large return value to a file
 */
async function saveReturnValueToFile(returnValue: string, workspaceDir?: string): Promise<string> {
  const workspace = workspaceDir ?? Deno.cwd()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `output-${timestamp}.txt`
  const filepath = `${workspace}/${filename}`

  await Deno.mkdir(workspace, { recursive: true })
  await Deno.writeTextFile(filepath, returnValue)

  return filepath
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
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
