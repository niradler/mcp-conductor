import type { ToolSpec } from "@mcp-conductor/core";

export const SANDBOX_CREATE: ToolSpec = {
  name: "sandbox_create",
  description: "Create a new OpenShell sandbox. Returns the created Sandbox resource.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["spec"],
    properties: {
      name: {
        type: "string",
        description:
          "Optional sandbox name. When omitted the OpenShell gateway generates one. Must match the configured sandboxNamePattern.",
      },
      spec: {
        type: "object",
        description:
          "openshell.v1.SandboxSpec. Requires { template: { image }, policy }. See @mcp-conductor/provider-openshell src/types.ts for the full structure.",
      },
    },
  },
};

export const SANDBOX_GET: ToolSpec = {
  name: "sandbox_get",
  description: "Look up a sandbox by name.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string", description: "Sandbox name." },
    },
  },
};

export const SANDBOX_LIST: ToolSpec = {
  name: "sandbox_list",
  description: "List sandboxes. Supports server-side pagination via limit/offset.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: {
        type: "integer",
        minimum: 0,
        maximum: 500,
        description: "Maximum sandboxes to return. 0 = server default. Clamped to 500.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Number of sandboxes to skip.",
      },
    },
  },
};

export const SANDBOX_DESTROY: ToolSpec = {
  name: "sandbox_destroy",
  description: "Delete a sandbox by name. Returns whether the deletion happened.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string", description: "Sandbox name." },
    },
  },
};

export const SANDBOX_EXEC: ToolSpec = {
  name: "sandbox_exec",
  description:
    "Run a command inside a sandbox. Streams stdout/stderr from the sandbox supervisor; returns aggregated output, exit code, and duration.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name", "command"],
    properties: {
      name: { type: "string", description: "Sandbox name." },
      command: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "Command + arguments. Not run through a shell.",
      },
      workdir: { type: "string", description: "Working directory inside the sandbox." },
      environment: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Extra environment variables for this exec.",
      },
      timeoutSeconds: {
        type: "integer",
        minimum: 0,
        description: "Server-side timeout. 0 = no extra timeout beyond the gateway's default.",
      },
      stdin: {
        type: "string",
        description: "UTF-8 input piped into the process before close.",
      },
    },
  },
};

export const SANDBOX_LOGS: ToolSpec = {
  name: "sandbox_logs",
  description: "Fetch supervisor logs for a sandbox.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string", description: "Sandbox name." },
      lines: {
        type: "integer",
        minimum: 1,
        maximum: 10_000,
        description: "Maximum log lines to return. Default 500.",
      },
      sinceMs: {
        type: "integer",
        minimum: 0,
        description: "Return only entries with timestamp >= sinceMs (ms since epoch).",
      },
    },
  },
};

export const POLICY_SET: ToolSpec = {
  name: "policy_set",
  description: "Replace the security policy for a sandbox.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name", "policy"],
    properties: {
      name: { type: "string", description: "Sandbox name." },
      policy: {
        type: "object",
        description:
          "openshell.sandbox.v1.SandboxPolicy. See @mcp-conductor/provider-openshell src/types.ts for the full structure.",
      },
    },
  },
};

export const POLICY_STATUS: ToolSpec = {
  name: "policy_status",
  description: "Get the policy status (revision, hash, applied state) for a sandbox.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string", description: "Sandbox name." },
      version: {
        type: "integer",
        minimum: 0,
        description: "Specific policy version. 0 = latest.",
      },
    },
  },
};
