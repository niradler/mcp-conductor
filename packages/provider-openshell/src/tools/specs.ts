import type { ToolSpec } from "@mcp-conductor/core";

export const SANDBOX_CREATE: ToolSpec = {
  name: "sandbox_create",
  description:
    "Create a new OpenShell sandbox. Returns the created Sandbox resource as JSON (fields: id, name, status, spec, created_at). " +
    "On failure returns isError with text 'create-failed: <reason>' or 'invalid sandbox name: <name>'. " +
    "Typical workflow: sandbox_create → sandbox_exec → sandbox_destroy.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["spec"],
    properties: {
      name: {
        type: "string",
        description:
          "Human-readable sandbox name (alphanumeric + hyphens). Omit to let the server generate one. " +
          "Use this name in all other sandbox_* tools — it is resolved to an internal ID automatically.",
      },
      spec: {
        type: "object",
        description:
          "Sandbox specification. Minimum shape: { template: { image: '<docker-image>' }, policy: {} }. " +
          "policy can be an empty object to use server defaults.",
      },
    },
  },
};

export const SANDBOX_GET: ToolSpec = {
  name: "sandbox_get",
  description:
    "Look up a sandbox by name. Returns the Sandbox resource as JSON (fields: id, name, status, spec, created_at). " +
    "On failure returns isError with text 'get-failed: <grpc error>'. " +
    "Returns isError with 'invalid sandbox name: <name>' if the name format is rejected.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: {
        type: "string",
        description: "Sandbox name (alphanumeric + hyphens). Must match the name used at sandbox_create time.",
      },
    },
  },
};

export const SANDBOX_LIST: ToolSpec = {
  name: "sandbox_list",
  description:
    "List all sandboxes. Returns a JSON object with a 'sandboxes' array and pagination metadata. " +
    "Supports cursor-style pagination via limit/offset. " +
    "On failure returns isError with text 'list-failed: <grpc error>'.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: {
        type: "integer",
        minimum: 0,
        maximum: 500,
        description:
          "Maximum number of sandboxes to return. 0 means use the server default. " +
          "Values above 500 are clamped to 500.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Number of sandboxes to skip before returning results. Used for pagination.",
      },
    },
  },
};

export const SANDBOX_DESTROY: ToolSpec = {
  name: "sandbox_destroy",
  description:
    "Delete a sandbox by name. Returns text 'deleted: true' if the sandbox existed and was removed, " +
    "'deleted: false' if it was already gone. " +
    "On failure returns isError with text 'destroy-failed: <grpc error>' or 'invalid sandbox name: <name>'.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: {
        type: "string",
        description: "Sandbox name (alphanumeric + hyphens). Must match the name used at sandbox_create time.",
      },
    },
  },
};

export const SANDBOX_EXEC: ToolSpec = {
  name: "sandbox_exec",
  description:
    "Run a command inside a sandbox. The command is executed directly (not via a shell). " +
    "Returns text in the format:\n" +
    "  exit: <N>\n\n  stdout:\n  <output>\n\n  stderr:\n  <output>\n\n  duration: <N>ms\n" +
    "isError is set when exit code is non-zero or the execution times out. " +
    "On timeout, returns isError with '[timeout] exec exceeded deadline\\n\\nstdout:...\\n\\nstderr:...'. " +
    "On sandbox not found, returns isError with 'sandbox not found: <name>'. " +
    "On gRPC failure, returns isError with 'exec-failed: <grpc error>'.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name", "command"],
    properties: {
      name: {
        type: "string",
        description: "Sandbox name (alphanumeric + hyphens). Must match the name used at sandbox_create time.",
      },
      command: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description:
          "Command and its arguments as a string array. Executed directly — not run through a shell. " +
          "Example: ['python', '-c', 'print(1+1)'] not ['sh', '-c', 'python ...']. " +
          "To run a shell command, use ['sh', '-c', '<your command>'] explicitly.",
      },
      workdir: {
        type: "string",
        description: "Absolute path to the working directory inside the sandbox. Defaults to the sandbox root.",
      },
      environment: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Extra environment variables for this exec only (merged with the sandbox base environment).",
      },
      timeoutSeconds: {
        type: "integer",
        minimum: 0,
        description:
          "Server-side execution timeout in seconds. 0 means no additional timeout beyond the gateway default. " +
          "On timeout, the tool returns isError with partial stdout/stderr captured so far.",
      },
      stdin: {
        type: "string",
        description: "UTF-8 string piped into the process stdin before it is closed. Omit for no stdin.",
      },
    },
  },
};

export const SANDBOX_LOGS: ToolSpec = {
  name: "sandbox_logs",
  description:
    "Fetch supervisor (infrastructure) logs for a sandbox. " +
    "Returns JSON with the supervisor log entries — this is NOT the stdout/stderr of commands run via sandbox_exec. " +
    "Use this for debugging sandbox startup, policy application, or container-level issues. " +
    "On sandbox not found, returns isError with 'sandbox not found: <name>'. " +
    "On gRPC failure, returns isError with 'logs-failed: <grpc error>'.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: {
        type: "string",
        description: "Sandbox name (alphanumeric + hyphens). Must match the name used at sandbox_create time.",
      },
      lines: {
        type: "integer",
        minimum: 1,
        maximum: 10000,
        description:
          "Maximum number of log lines to return. Defaults to 500 if omitted. Values above 10000 are clamped to 10000.",
      },
      sinceMs: {
        type: "integer",
        minimum: 0,
        description:
          "Only return log entries with a timestamp at or after this value (milliseconds since Unix epoch). " +
          "Omit or pass 0 to return all entries up to the line limit.",
      },
    },
  },
};

export const POLICY_SET: ToolSpec = {
  name: "policy_set",
  description:
    "Replace the security policy for a sandbox (sandbox-scoped, not global). " +
    "This is a full replacement — the entire policy object is overwritten, not merged. " +
    "Returns a JSON confirmation of the update. " +
    "On failure returns isError with text 'policy-set-failed: <grpc error>' or 'invalid sandbox name: <name>'.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name", "policy"],
    properties: {
      name: {
        type: "string",
        description: "Sandbox name (alphanumeric + hyphens). Must match the name used at sandbox_create time.",
      },
      policy: {
        type: "object",
        description:
          "Full SandboxPolicy object to apply. All omitted fields revert to server defaults. " +
          "Top-level fields: version (integer, default 1), filesystem ({ include_workdir, read_only: string[], read_write: string[] }), " +
          "landlock ({ compatibility: 'best_effort' | 'hard_requirement' }), " +
          "process ({ run_as_user, run_as_group }), " +
          "network_policies (record of named NetworkPolicyRule objects with endpoints and binaries arrays). " +
          "Pass {} to reset to server defaults.",
      },
    },
  },
};

export const POLICY_STATUS: ToolSpec = {
  name: "policy_status",
  description:
    "Get the current policy status for a sandbox (sandbox-scoped). " +
    "Returns JSON with fields: revision (integer), hash (string), applied (boolean), and the policy object at that version. " +
    "On failure returns isError with text 'policy-status-failed: <grpc error>' or 'invalid sandbox name: <name>'.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: {
        type: "string",
        description: "Sandbox name (alphanumeric + hyphens). Must match the name used at sandbox_create time.",
      },
      version: {
        type: "integer",
        minimum: 0,
        description:
          "Policy version to retrieve. 0 (or omit) to get the latest applied version. " +
          "Use a specific integer to retrieve a historical policy revision.",
      },
    },
  },
};
