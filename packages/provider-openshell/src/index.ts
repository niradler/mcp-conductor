export const VERSION = "0.1.0";

export { OpenShellProvider } from "./openshell-provider.js";
export type { OpenShellProviderDeps } from "./openshell-provider.js";

export { OpenShellClient } from "./openshell-client.js";
export type { ClientOptions, ExecResult } from "./openshell-client.js";

export {
  OpenShellProviderOptionsSchema,
  TlsSchema,
  TimeoutsSchema,
} from "./config.js";
export type { OpenShellProviderOptions, TlsConfig, Timeouts } from "./config.js";

export {
  SandboxPolicySchema,
  SandboxSpecSchema,
  SandboxTemplateSchema,
  NetworkPolicyRuleSchema,
  NetworkEndpointSchema,
  L7AllowSchema,
} from "./types.js";
