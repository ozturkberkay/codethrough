// Build the walkthrough runner the server streams: run the engine and forward each
// chunk the moment it is produced. The engine is injected, so this is tested with a
// fake engine and no Anthropic call.
//
// The engine emits its own error chunk for a normal failure (refusal, max tokens,
// parse). An unexpected throw is also turned into a final error chunk, so the
// frontend shows a clear "failed" state instead of a stream that just stops. The
// signal stops a cancelled run, even part-way through.

import type { EngineConfig, EngineInput } from "@codethrough/engine";
import type { WalkthroughChunk } from "@codethrough/schema";

import { optionalField } from "../optional.js";
import type { WalkthroughRunner } from "../server/review_source.js";

// The injected streaming engine: the real one, or a fake. We only need its shape.
// The signal is the run's abort signal, passed in so the engine stops the billed
// Anthropic stream on a cancel or disconnect, not just the local reading.
type StreamEngineFn = (
  input: EngineInput,
  config: EngineConfig,
  deps?: { log?: (message: string) => void; signal?: AbortSignal },
) => AsyncIterable<WalkthroughChunk>;

// What the runner needs: the engine, its input and config, and an optional logger
// passed into the engine.
interface WalkthroughRunnerDeps {
  streamEngine: StreamEngineFn;
  input: EngineInput;
  config: EngineConfig;
  log?: (message: string) => void;
}

// The error kind of a chunk (for the mapper's return type).
type ErrorChunk = Extract<WalkthroughChunk, { type: "error" }>;

// The message of a thrown value: the error's message, or a generic fallback.
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "engine run failed";

// Turn an unexpected engine throw into the closest error chunk, guessing the kind
// from the message. Normal failures are emitted by the engine as chunks; this only
// handles a throw that escaped it.
const errorChunkFor = (message: string): ErrorChunk => {
  if (message.includes("max_tokens")) {
    return { type: "error", kind: "max_tokens", message };
  }
  if (message.includes("refusal")) {
    return { type: "error", kind: "refusal", message };
  }
  return { type: "error", kind: "parse", message };
};

// Build the runner. Each call streams the engine once and yields each chunk as it
// arrives. A cancelled signal yields nothing more (whether it was already aborted
// or aborts part-way through). An unexpected throw becomes a final error chunk.
const createWalkthroughRunner =
  (deps: WalkthroughRunnerDeps): WalkthroughRunner =>
  (signal: AbortSignal): AsyncIterable<WalkthroughChunk> =>
    (async function* runGen(): AsyncIterable<WalkthroughChunk> {
      if (signal.aborted) {
        return;
      }
      try {
        // Pass the run signal into the engine so a cancel or disconnect stops the
        // billed Anthropic stream, not just the local reading below.
        const stream = deps.streamEngine(deps.input, deps.config, {
          ...optionalField("log", deps.log),
          signal,
        });
        for await (const chunk of stream) {
          if (signal.aborted) {
            return;
          }
          yield chunk;
        }
      } catch (error) {
        yield errorChunkFor(messageOf(error));
      }
    })();

export { createWalkthroughRunner, errorChunkFor, messageOf };
export type { StreamEngineFn, WalkthroughRunnerDeps };
