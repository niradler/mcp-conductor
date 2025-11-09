import http from 'node:http'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import type { MCPRPCRequest, MCPRPCResponse } from '../types/types.ts'
import type { MCPManager } from './manager.ts'
import { validateRPCArgs } from './errors.ts'
import { MCP_PROXY_CONSTANTS } from './constants.ts'

export class MCPRPCServer {
  private server: http.Server | null = null
  private port: number = 0
  private manager: MCPManager
  private authToken: string

  constructor(manager: MCPManager) {
    this.manager = manager
    this.authToken = randomBytes(32).toString('hex')
  }

  getAuthToken(): string {
    return this.authToken
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        if (req.url === '/mcp-rpc' && req.method === 'POST') {
          await this.handleRPCRequest(req, res)
        } else if (req.url === '/health' && req.method === 'GET') {
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/plain')
          res.end('OK')
        } else {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain')
          res.end('Not Found')
        }
      })

      this.server.on('error', reject)

      this.server.listen(0, 'localhost', () => {
        const address = this.server!.address()
        if (address && typeof address !== 'string') {
          this.port = address.port
          console.error(`MCP RPC server listening on http://localhost:${this.port}`)
          resolve(this.port)
        } else {
          reject(new Error('Failed to get server port'))
        }
      })
    })
  }

  private async handleRPCRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      // Check authentication
      const authHeader = req.headers['authorization']
      if (authHeader !== `Bearer ${this.authToken}`) {
        res.statusCode = 401
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      // Get body with size limit
      const body = await this.getRequestBody(req)

      // Validate and parse request
      const request = JSON.parse(body) as MCPRPCRequest

      // Validate server name (prevent path traversal)
      if (!this.isValidServerName(request.server)) {
        throw new Error('Invalid server name')
      }

      let result: unknown
      let error: string | undefined

      try {
        switch (request.method) {
          case 'callTool':
            validateRPCArgs(request.args, 2, 'callTool')
            result = await this.manager.callTool(
              request.server,
              request.args[0] as string,
              request.args[1],
            )
            break

          case 'listTools':
            result = await this.manager.listTools(request.server)
            break

          case 'listResources':
            result = await this.manager.listResources(request.server)
            break

          case 'readResource':
            validateRPCArgs(request.args, 1, 'readResource')
            result = await this.manager.readResource(
              request.server,
              request.args[0] as string,
            )
            break

          case 'listPrompts':
            result = await this.manager.listPrompts(request.server)
            break

          case 'getPrompt':
            validateRPCArgs(request.args, 2, 'getPrompt')
            result = await this.manager.getPrompt(
              request.server,
              request.args[0] as string,
              request.args[1],
            )
            break

          default:
            throw new Error(`Unknown method: ${request.method}`)
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }

      const response: MCPRPCResponse = {
        result,
        error,
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(response))
    } catch (err) {
      console.error('RPC request error:', err)
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  private isValidServerName(serverName: string): boolean {
    // Only alphanumeric, dash, underscore
    return /^[a-zA-Z0-9_-]+$/.test(serverName)
  }

  private getRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const bodyParts: Buffer[] = []
      let totalSize = 0

      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length

        if (totalSize > MCP_PROXY_CONSTANTS.RPC.MAX_BODY_SIZE) {
          req.destroy()
          reject(new Error('Request body too large'))
          return
        }

        bodyParts.push(chunk)
      })
      req.on('end', () => {
        const body = Buffer.concat(bodyParts).toString()
        resolve(body)
      })
      req.on('error', reject)
    })
  }

  getPort(): number {
    return this.port
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server!.close((err) => {
          if (err) {
            reject(err)
          } else {
            console.error('MCP RPC server stopped')
            resolve()
          }
        })
      })
    }
  }
}
