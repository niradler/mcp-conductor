export function generateMcpFactoryCode(rpcPort: number, authToken: string): string {
  return `
async function mcpRpcCall(rpcUrl, authToken, request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${authToken}\`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
    }
    
    const result = await response.json();
    if (result.error) {
      throw new Error(result.error);
    }
    
    return result.result;
  } finally {
    clearTimeout(timeoutId);
  }
}

const mcpFactory = {
  _rpcUrl: 'http://localhost:${rpcPort}/mcp-rpc',
  _authToken: '${authToken}',
  
  async load(serverName) {
    const factory = this;
    
    return {
      async callTool(name, args) {
        return await mcpRpcCall(factory._rpcUrl, factory._authToken, {
          server: serverName,
          method: 'callTool',
          args: [name, args]
        });
      },
      
      async listTools() {
        return await mcpRpcCall(factory._rpcUrl, factory._authToken, {
          server: serverName,
          method: 'listTools',
          args: []
        });
      },
      
      async listResources() {
        return await mcpRpcCall(factory._rpcUrl, factory._authToken, {
          server: serverName,
          method: 'listResources',
          args: []
        });
      },
      
      async readResource(uri) {
        return await mcpRpcCall(factory._rpcUrl, factory._authToken, {
          server: serverName,
          method: 'readResource',
          args: [uri]
        });
      },
      
      async listPrompts() {
        return await mcpRpcCall(factory._rpcUrl, factory._authToken, {
          server: serverName,
          method: 'listPrompts',
          args: []
        });
      },
      
      async getPrompt(name, args) {
        return await mcpRpcCall(factory._rpcUrl, factory._authToken, {
          server: serverName,
          method: 'getPrompt',
          args: [name, args]
        });
      }
    };
  }
};
`.trim()
}

