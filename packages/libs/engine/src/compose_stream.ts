// Phase 2, streaming. The same model call as compose.ts, but the streamed text is
// fed into the pipeline in stream_chunks.ts, which hands back chunks as the response
// arrives (the summary, each checked step, usage, done, or a single error chunk).
// compose.ts is left alone.
//
// The provider gives one stream of events: text deltas, then a final event with the
// stop reason and token counts. This file turns that one stream into the pair the
// pipeline reads from: texts() yields each delta and stashes the final event, and
// finalize() returns it. Only that adapting happens here.

import type { StreamEvent } from "@codethrough/model";
import type { WalkthroughChunk } from "@codethrough/schema";

import { walkthroughOutputSchema } from "./compose_output.js";
import { buildPrompt } from "./compose_prompt.js";
import type { HunkCatalog } from "./hunk_catalog.js";
import { type PhaseOptions, resolveComposeDeps } from "./runtime.js";
import { type ComposeStreamSource, extractToChunks, type FinalInfo } from "./stream_chunks.js";

/** Compose options (config and provider, no runner). */
interface ComposeStreamOptions extends Omit<PhaseOptions, "run"> {
  /** Set when the catalog was trimmed, so the model is told it is partial. */
  truncated?: boolean;
  /**
   * Aborts the model stream when the client cancels or disconnects, so we stop paying
   * for a request nobody is reading.
   */
  signal?: AbortSignal;
}

// If the stream ends without a final event the provider broke its contract, so we
// fall back to this instead of hanging. The real provider always sends one.
const NO_FINAL: FinalInfo = { stopReason: "other", inputTokens: 0, outputTokens: 0 };

/** Turn the provider's final event into the pipeline's FinalInfo. */
const toFinalInfo = (event: Extract<StreamEvent, { type: "final" }>): FinalInfo => ({
  stopReason: event.stopReason,
  inputTokens: event.usage.inputTokens,
  outputTokens: event.usage.outputTokens,
});

/**
 * Turn the provider's one event stream into the pair the pipeline reads from. texts()
 * walks the events, yielding each text delta and resolving the final event (or a
 * zero-usage fallback if there was none); finalize() awaits that same result. The
 * pipeline drains texts() before calling finalize(), so events are read once.
 */
const sourceFromStream = (stream: AsyncIterable<StreamEvent>): ComposeStreamSource => {
  // Draining texts() resolves this with the final info, and finalize() awaits it. A
  // shared promise lets finalize() wait for the drain instead of guessing a value.
  const drained = Promise.withResolvers<FinalInfo>();
  return {
    texts: async function* textsGen(): AsyncIterable<string> {
      let final: FinalInfo = NO_FINAL;
      for await (const event of stream) {
        if (event.type === "text") {
          yield event.text;
        } else {
          final = toFinalInfo(event);
        }
      }
      drained.resolve(final);
    },
    finalize: (): Promise<FinalInfo> => drained.promise,
  };
};

/**
 * Run phase 2 as a stream, handing back chunks as the response arrives. Same request
 * as compose(), but the summary and each checked step come out as they arrive, then
 * usage and done (or one error chunk on a refusal, token limit, or parse failure).
 * The provider is injected for tests, just like compose().
 */
const composeStream = (
  catalog: HunkCatalog,
  brief: string,
  opts: ComposeStreamOptions,
): AsyncGenerator<WalkthroughChunk> => {
  const { provider, config, log } = resolveComposeDeps(opts);
  const stream = provider.composeStream({
    prompt: buildPrompt(catalog, brief, opts),
    outputSchema: walkthroughOutputSchema(),
    maxTokens: config.compose.maxTokens,
    // Pass the abort signal so a cancel stops the request; leave it out when none was
    // given.
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  return extractToChunks(sourceFromStream(stream), { catalog, config, log });
};

export { composeStream };
export type { ComposeStreamOptions };
