// Phase 1: exploration. The model uses three read-only tools (read a file, run grep,
// list files) over the local clone to gather context before writing the walkthrough.
// This file owns the prompt, the tools, and the overall time limit; the actual
// tool-use loop runs behind the injected provider.

import type { EngineLogger } from "./command.js";
import type { ChangedFile } from "./diff_summary.js";
import { buildExplorePrompt } from "./explore_prompt.js";
import { buildTools } from "./explore_tools.js";
import type { HunkCatalog } from "./hunk_catalog.js";
import { type PhaseOptions, resolveExploreDeps } from "./runtime.js";
import type { EngineInput } from "./types.js";

// The explore limits (loop count, token budget, phase and tool timeouts, file and
// match caps) all come from config. Each one bounds the loop so the phase cannot
// hang.
const MS_PER_SECOND = 1_000;
const ONE_DECIMAL = 1;

/**
 * Options for the explore phase, plus the changed-files list. runEngine passes
 * `changedFiles` from its one diff parse so the prompt does not parse again; when
 * left out, the prompt works it out from the diff.
 */
interface ExploreOptions extends PhaseOptions {
  changedFiles?: ChangedFile[];
}

/** Log how long the phase took. */
const logPhase = (log: EngineLogger, startedAt: number, aborted: boolean): void => {
  const seconds = ((Date.now() - startedAt) / MS_PER_SECOND).toFixed(ONE_DECIMAL);
  const why = aborted ? "the wall-clock bound" : "the model stopped";
  log(`Exploration finished in ${seconds}s (${why}).`);
};

/**
 * Run phase 1 and return the context brief. A timer bounds the whole phase; if it
 * fires (or the loop hits its limit) the provider returns the brief gathered so far
 * rather than crashing. The provider, runner, and logger are injected for tests.
 * `opts.changedFiles`, when given, is reused so the prompt does not parse the diff
 * again.
 */
const explore = async (
  input: EngineInput,
  catalog: HunkCatalog,
  opts: ExploreOptions,
): Promise<string> => {
  const { provider, run, log, hasRipgrep, config } = resolveExploreDeps(opts);
  const { explore: bounds } = config;

  const controller = new AbortController();
  const phaseTimer = setTimeout(() => controller.abort(), bounds.phaseTimeoutMs);
  const startedAt = Date.now();

  try {
    return await provider.explore({
      prompt: buildExplorePrompt(input, catalog, opts.changedFiles),
      tools: buildTools({
        repoRoot: input.repoRoot,
        run,
        hasRipgrep,
        limits: {
          toolTimeoutMs: bounds.toolTimeoutMs,
          maxFileBytes: bounds.maxFileBytes,
          maxMatches: bounds.maxMatches,
        },
      }),
      maxIterations: bounds.maxIterations,
      maxTokens: bounds.maxTokens,
      signal: controller.signal,
      log,
    });
  } finally {
    clearTimeout(phaseTimer);
    logPhase(log, startedAt, controller.signal.aborted);
  }
};

export { explore };
export type { ExploreOptions };
