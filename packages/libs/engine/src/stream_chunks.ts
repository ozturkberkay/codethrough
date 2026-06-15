// Turns the streamed text plus the final stop reason and token usage into the
// sequence of chunks the caller reads: the summary, each checked and numbered step,
// then usage and done, or a single error chunk. No I/O. It reads the stream through
// a small seam so tests can drive it with a fake; compose_stream.ts builds that seam
// from a real provider.
//
//   text -> reader -> check each step -> chunks ; then finalize -> usage/done or error
//
// This file ties several modules together, so the dependency-count rule (meant for
// tangled modules) is turned off here as in other glue files.
/* oxlint-disable import/max-dependencies */

import type { StopReason } from "@codethrough/model";
import type { Summary, WalkthroughChunk } from "@codethrough/schema";

import type { EngineLogger } from "./command.js";
import type { EngineConfig } from "./config.js";
import type { HunkCatalog } from "./hunk_catalog.js";
import { estimateCostUsd, isKnownModel } from "./pricing.js";
import { createExtractor } from "./stream_parse.js";
import { createStepValidator, parseSummary, type StepValidator } from "./stream_validate.js";

/** What we learn when the stream ends: why it stopped and the token counts. */
interface FinalInfo {
  stopReason: StopReason;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The small seam this pipeline reads from: the streamed text, plus a finalize call
 * for the end info. The real shell builds it from a provider; tests build it from
 * scripted events. This keeps the pipeline free of any provider types.
 */
interface ComposeStreamSource {
  texts: () => AsyncIterable<string>;
  finalize: () => Promise<FinalInfo>;
}

// Stop reasons that mean there is no usable walkthrough, mapped to the error chunk's
// kind. A refusal or hitting the token limit are failures; any other stop that
// produced nothing is reported as a parse failure below.
const ERROR_KIND: Partial<Record<StopReason, "refusal" | "max_tokens">> = {
  refusal: "refusal",
  max_tokens: "max_tokens",
};

/** Build the usage chunk from the token counts + the model-priced cost. */
const usageChunk = (config: EngineConfig, final: FinalInfo): WalkthroughChunk => ({
  type: "usage",
  inputTokens: final.inputTokens,
  outputTokens: final.outputTokens,
  costUsd: estimateCostUsd(config.model, {
    inputTokens: final.inputTokens,
    outputTokens: final.outputTokens,
  }),
});

/**
 * The fixed inputs the pipeline carries throughout: the catalog (to check steps),
 * the config (the model, for pricing), and the logger. Bundled so the generators
 * below stay under the parameter limit.
 */
interface PipelineCtx {
  catalog: HunkCatalog;
  config: EngineConfig;
  log: EngineLogger;
}

/**
 * The state that changes as the stream runs: the per-step validator (it counts kept
 * steps for numbering) and `anyOutput`, whether anything usable (a summary or a step)
 * came out. A normal stop with nothing usable is a parse error, but even a partial
 * result (say steps but no summary) still reports cost.
 */
interface StreamState {
  validator: StepValidator;
  anyOutput: boolean;
}

/**
 * Turn one piece from the reader into its chunk: a summary that passes, or a step
 * that passes the catalog rules (numbered to its kept position). A bad summary, a
 * dropped step, or a bad step gives null (logged and skipped). Updates the stream
 * state as a side effect.
 */
const chunkForEvent = (
  event: { kind: "summary" | "step"; raw: string },
  state: StreamState,
  ctx: PipelineCtx,
): WalkthroughChunk | null => {
  if (event.kind === "summary") {
    const summary: Summary | null = parseSummary(event.raw);
    if (summary === null) {
      ctx.log("Streamed summary did not validate; skipping the summary chunk.");
      return null;
    }
    state.anyOutput = true;
    return { type: "summary", summary };
  }
  const outcome = state.validator.next(event.raw);
  if (outcome.kind === "skip") {
    ctx.log(`Dropped streamed step: ${outcome.reason}`);
    return null;
  }
  state.anyOutput = true;
  return { type: "step", step: outcome.step };
};

/**
 * Read the streamed text and yield the summary, then each surviving step in arrival
 * order. The validator numbers each kept step; dropped or bad steps are logged and
 * skipped. `state.anyOutput` records whether anything came out, which the end-of-
 * stream decision reads. The core of composeStream, free of provider types.
 */
const streamBody = async function* streamBodyGen(
  source: ComposeStreamSource,
  state: StreamState,
  ctx: PipelineCtx,
): AsyncGenerator<WalkthroughChunk> {
  const extractor = createExtractor();
  for await (const delta of source.texts()) {
    for (const event of extractor.push(delta)) {
      const chunk = chunkForEvent(event, state, ctx);
      if (chunk !== null) {
        yield chunk;
      }
    }
  }
};

/** Build the error chunk for a stop reason that means there is no walkthrough. */
const errorChunk = (
  kind: "refusal" | "max_tokens" | "parse",
  detail: string,
): WalkthroughChunk => ({
  type: "error",
  kind,
  message: `compose stopped without a usable walkthrough: ${detail}`,
});

/**
 * Decide the last chunks after the body:
 *  - refusal or token limit -> the matching error chunk, no usage/done (any steps
 *    that finished before the cut were already sent);
 *  - a normal stop that produced nothing usable -> a parse error;
 *  - otherwise (even a partial result) -> a usage chunk (real tokens plus cost) and
 *    done, so cost is always reported. An unknown model costs 0 with a logged note.
 */
const finishChunks = function* finishChunksGen(
  final: FinalInfo,
  state: StreamState,
  ctx: PipelineCtx,
): Generator<WalkthroughChunk> {
  const kind = ERROR_KIND[final.stopReason];
  if (kind !== undefined) {
    yield errorChunk(kind, kind);
    return;
  }
  if (!state.anyOutput) {
    yield errorChunk("parse", `${final.stopReason} with no parseable output`);
    return;
  }
  if (!isKnownModel(ctx.config.model)) {
    ctx.log(`No pricing for model "${ctx.config.model}"; reporting cost 0.`);
  }
  yield usageChunk(ctx.config, final);
  yield { type: "done" };
};

/**
 * The whole pipeline: yield the body chunks, then finalize and yield the last
 * chunks. Reads through the stream seam so tests can drive it with a fake.
 */
const extractToChunks = async function* extractToChunksGen(
  source: ComposeStreamSource,
  ctx: PipelineCtx,
): AsyncGenerator<WalkthroughChunk> {
  const state: StreamState = { validator: createStepValidator(ctx.catalog), anyOutput: false };
  yield* streamBody(source, state, ctx);
  const final = await source.finalize();
  yield* finishChunks(final, state, ctx);
};

export { extractToChunks };
export type { ComposeStreamSource, FinalInfo, PipelineCtx };
