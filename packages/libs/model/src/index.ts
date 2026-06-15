// What this package exposes: the SDK-agnostic provider interface, the Anthropic
// provider, and the credential lookup. Values first, then types. This is the only
// package that uses the Anthropic SDK; everything else sees only the interface.

export { createAnthropicProvider } from "./providers/anthropic.js";
export { resolveAnthropicCredential } from "./credential.js";
export { clientFor, defaultCredentialDeps } from "./runtime.js";

// Type-only exports.
export type { AnthropicProviderOptions, Effort } from "./providers/anthropic.js";
export type { AnthropicCredential, CredentialCommandResult, CredentialDeps } from "./credential.js";
export type {
  ComposeRequest,
  ExploreRequest,
  ModelProvider,
  ModelTool,
  StopReason,
  StreamEvent,
  TokenUsage,
} from "./port.js";
