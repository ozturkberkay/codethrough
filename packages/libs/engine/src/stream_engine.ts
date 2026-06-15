// The streaming engine entrypoint: the same setup as runEngine (build and trim the
// catalog, then explore), followed by streaming compose, handing back chunks as they
// arrive (the summary, each checked step, usage, done, or one error chunk on a
// refusal, token limit, or parse failure). The CLI's walkthrough route reads this so
// the frontend fills in as it goes.
//
// It shares the setup with runEngine and leaves the per-step checking and chunks to
// composeStream. All I/O pieces are injected, so it is tested with a fake streaming
// provider and no network.

import type { WalkthroughChunk } from "@codethrough/schema";

import { composeStream } from "./compose_stream.js";
import type { EngineConfig } from "./config.js";
import { type EngineDeps, prepareCompose } from "./prepare_compose.js";
import type { EngineInput } from "./types.js";

/**
 * Run the engine and stream the walkthrough chunk by chunk. Explore runs to a brief
 * first, then compose streams: the summary the moment it finishes, each step the
 * moment it finishes and passes the catalog rules (numbered to its kept position),
 * then usage and done. The injected provider makes this testable with a fake.
 *
 * `deps.signal`, when given, is passed on to streaming compose so a cancel or
 * disconnect stops the model request, not just the local reading; explore handles its
 * own time limit.
 */
const streamEngine = async function* streamEngineGen(
  input: EngineInput,
  config: EngineConfig,
  deps: EngineDeps,
): AsyncGenerator<WalkthroughChunk> {
  const { log, catalog, brief, composeOpts } = await prepareCompose(input, config, deps);

  log("Composing the walkthrough (phase 2, streaming) ...");
  yield* composeStream(catalog, brief, {
    ...composeOpts,
    truncated: catalog.truncated,
    // Pass the signal only when present; an explicit undefined is not allowed here.
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
};

export { streamEngine };
