// Runs the phases in order, with all I/O pieces injected, and returns the final
// checked result in one shot. The streaming version (streamEngine) shares the setup
// and hands back chunks instead.
//
//   build catalog -> trim catalog -> explore -> compose -> check steps

import type { Walkthrough } from "@codethrough/schema";

import { compose } from "./compose.js";
import type { EngineConfig } from "./config.js";
import type { deriveDiffViews } from "./diff_views.js";
import { type EngineDeps, prepareCompose } from "./prepare_compose.js";
import type { EngineInput } from "./types.js";
import { validateSteps } from "./walkthrough.js";

/** What a finished run hands back: the walkthrough, the trimmed catalog, the report. */
interface EngineResult {
  walkthrough: Walkthrough;
  catalog: ReturnType<typeof deriveDiffViews>["catalog"];
  validation: ReturnType<typeof validateSteps>;
}

/**
 * Run the whole pipeline and return the checked result. The catalog is trimmed before
 * both model phases so even a very large PR fits the model's context. Progress goes to
 * the injected logger; the trim and any dropped or adjusted steps are logged so a
 * caller can show them.
 */
const runEngine = async (
  input: EngineInput,
  config: EngineConfig,
  deps: EngineDeps,
): Promise<EngineResult> => {
  const { log, catalog, brief, composeOpts } = await prepareCompose(input, config, deps);

  log("Composing the walkthrough (phase 2) ...");
  const walkthrough = await compose(catalog, brief, {
    ...composeOpts,
    truncated: catalog.truncated,
  });

  const validation = validateSteps(walkthrough.steps, catalog);
  for (const d of validation.dropped) {
    log(`Dropped step (hunk ${d.step.hunkId}, order ${d.step.order}): ${d.reason}`);
  }
  for (const a of validation.adjusted) {
    log(`Step kept as a whole-hunk highlight (hunk ${a.step.hunkId}): ${a.reason}`);
  }

  return { walkthrough, catalog, validation };
};

export { runEngine };
export type { EngineDeps, EngineResult };
