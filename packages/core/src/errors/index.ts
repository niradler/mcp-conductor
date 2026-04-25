export class ConfigError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class ProviderError extends Error {
  constructor(message: string, public readonly provider: string) {
    super(message);
    this.name = "ProviderError";
  }
}

export type SandboxErrorType = "syntax" | "runtime" | "timeout" | "permission" | "not_allowed";

export class SandboxError extends Error {
  constructor(message: string, public readonly errorType: SandboxErrorType) {
    super(message);
    this.name = "SandboxError";
  }
}
