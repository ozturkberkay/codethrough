// Connects the model to the engine for a run: find the Anthropic credential, build
// a provider from the run's model and effort, and call the real engine with it.
// The credential resolver, provider factory, and engine are injected, so this is
// tested with fakes and no network. The real ones are wired in runtime.ts.

import type { EngineConfig, EngineInput } from "@codethrough/engine";
import type { AnthropicCredential, ModelProvider } from "@codethrough/model";
import type { WalkthroughChunk } from "@codethrough/schema";

import type { StreamEngineFn } from "./walkthrough_runner.js";

// The message shown when no credential is found. Names each accepted source so the
// user can fix it without the docs.
const NO_CREDENTIAL_MESSAGE =
  "No Anthropic credential found. Set ANTHROPIC_API_KEY, or sign in with the Claude CLI " +
  "(run `claude`) to use your Claude subscription.";

// Added when the credential has expired.
const EXPIRED_NOTE = " Your Claude credential looks expired; run `claude` to refresh it.";

// How the real engine is called once a provider exists: the provider plus the
// optional log and signal the runner passes in.
type EngineRun = (
  input: EngineInput,
  config: EngineConfig,
  deps: { provider: ModelProvider; log?: (message: string) => void; signal?: AbortSignal },
) => AsyncIterable<WalkthroughChunk>;

// Build a provider from a credential and the run's model and effort.
type ProviderFactory = (args: {
  model: string;
  effort: EngineConfig["effort"];
  credential: AnthropicCredential;
}) => ModelProvider;

// The injected helpers: find the credential (null when none), build a provider,
// and run the real engine.
interface ModelEngineDeps {
  resolveCredential: () => AnthropicCredential | null;
  createProvider: ProviderFactory;
  runEngineStream: EngineRun;
}

/**
 * Build the engine the run wiring injects. It finds the credential up front
 * (throwing a clear error when there is none, with a note if it has expired),
 * builds a provider, and calls the real engine with it. The credential is found
 * per call, which is fine since a run is one call.
 */
const createModelStreamEngine =
  (deps: ModelEngineDeps): StreamEngineFn =>
  (input, config, runDeps): AsyncIterable<WalkthroughChunk> => {
    const credential = deps.resolveCredential();
    if (credential === null) {
      throw new Error(NO_CREDENTIAL_MESSAGE);
    }
    if (credential.kind === "oauth" && credential.expired === true) {
      // The token may still work; surface the refresh hint but proceed with it.
      runDeps?.log?.(EXPIRED_NOTE.trim());
    }
    const provider = deps.createProvider({
      model: config.model,
      effort: config.effort,
      credential,
    });
    return deps.runEngineStream(input, config, {
      provider,
      ...(runDeps?.log ? { log: runDeps.log } : {}),
      ...(runDeps?.signal ? { signal: runDeps.signal } : {}),
    });
  };

export { createModelStreamEngine, EXPIRED_NOTE, NO_CREDENTIAL_MESSAGE };
export type { EngineRun, ModelEngineDeps, ProviderFactory };
