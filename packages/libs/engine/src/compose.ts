// Phase 2: compose. One streaming model call turns the hunk catalog and the explore
// brief into a valid walkthrough whose steps only point at catalog hunk ids. The
// prompt is built in compose_prompt.ts and the output schema, collecting, and
// re-checking in compose_output.ts; the model call runs behind the injected provider.

import type { Walkthrough } from "@codethrough/schema";

import type { EngineLogger } from "./command.js";
import {
  accumulateOutput,
  walkthroughFromOutput,
  walkthroughOutputSchema,
} from "./compose_output.js";
import { buildPrompt } from "./compose_prompt.js";
import type { HunkCatalog } from "./hunk_catalog.js";
import { type PhaseOptions, resolveComposeDeps } from "./runtime.js";

const MS_PER_SECOND = 1_000;
const ONE_DECIMAL = 1;

/** Compose options (config and provider, no runner). */
interface ComposeOptions extends Omit<PhaseOptions, "run"> {
  /** Set when the catalog was trimmed, so the model is told it is partial. */
  truncated?: boolean;
}

/** Log how long compose took and why it stopped. */
const logPhase = (log: EngineLogger, startedAt: number, stopReason: string): void => {
  const seconds = ((Date.now() - startedAt) / MS_PER_SECOND).toFixed(ONE_DECIMAL);
  log(`Compose finished in ${seconds}s (stop_reason: ${stopReason}).`);
};

/**
 * Run phase 2 and return the valid walkthrough. It streams because the large token
 * budget could otherwise time out the request. The provider is injected for tests.
 *
 * The CLI uses only the streaming path, but this whole-message version (and runEngine,
 * which wraps it) is the batch API other callers will use, so it is kept on purpose.
 */
const compose = async (
  catalog: HunkCatalog,
  brief: string,
  opts: ComposeOptions,
): Promise<Walkthrough> => {
  const { provider, config, log } = resolveComposeDeps(opts);
  const startedAt = Date.now();

  const stream = provider.composeStream({
    prompt: buildPrompt(catalog, brief, opts),
    outputSchema: walkthroughOutputSchema(),
    maxTokens: config.compose.maxTokens,
  });
  const { text, stopReason } = await accumulateOutput(stream);

  logPhase(log, startedAt, stopReason);
  return walkthroughFromOutput(text, stopReason);
};

export { buildPrompt, compose, walkthroughFromOutput, walkthroughOutputSchema };
export type { ComposeOptions };
