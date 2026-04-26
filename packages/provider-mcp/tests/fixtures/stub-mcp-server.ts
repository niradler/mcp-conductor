#!/usr/bin/env node
// Minimal MCP stdio server for tests. Advertises:
//   echo(text: string)  -> returns text
//   throw()             -> returns isError:true with "boom" (tool-level error)
//   slow(ms: number)    -> sleeps ms then returns; used to exercise abort/timeout
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "stub", version: "0.0.1", description: "Stub MCP server used for tests." },
  { capabilities: { tools: {} }, instructions: "Call echo(text) to round-trip a string." },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "echo",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
    {
      name: "throw",
      description: "throw",
      inputSchema: { type: "object" },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "echo") {
    const text = (req.params.arguments as { text?: string } | undefined)?.text ?? "";
    return { content: [{ type: "text", text }] };
  }
  if (req.params.name === "throw") {
    return { isError: true, content: [{ type: "text", text: "boom" }] };
  }
  if (req.params.name === "slow") {
    const ms = (req.params.arguments as { ms?: number } | undefined)?.ms ?? 1000;
    await new Promise((r) => setTimeout(r, ms));
    return { content: [{ type: "text", text: `slept ${ms}ms` }] };
  }
  throw new Error(`unknown tool: ${req.params.name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
