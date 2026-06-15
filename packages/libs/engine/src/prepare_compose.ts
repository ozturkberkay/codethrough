// The shared setup before compose: parse the diff once, trim the catalog, log the
// trim, and run explore to a brief. Both the batch and streaming engines start here,
// so the trim, the explore wiring, and the option resolution live in one place. The
// I/O pieces are injected, so this is covered by the engine integration tests with a
// fake provider.

import type { ModelProvider } from "@codethrough/model";

import type { CommandRunner, EngineLogger } from "./command.js";
import type { EngineConfig } from "./config.js";
import { deriveDiffViews } from "./diff_views.js";
import { explore } from "./explore.js";
import type { CappedCatalog } from "./hunk_catalog.js";
import type { EngineInput } from "./types.js";

const noop: EngineLogger = () => {};

/** The injected pieces both engine entrypoints accept (for tests). */
interface EngineDeps {
  /** The model provider (the CLI builds it from the credential and config). */
  provider: ModelProvider;
  run?: CommandRunner;
  log?: EngineLogger;
  /**
   * Aborts the whole run. The streaming engine passes it on so a cancel stops the
   * request; the batch engine ignores it. Optional, so callers need not pass one.
   */
  signal?: AbortSignal;
}

/** The compose options both entrypoints pass to compose / composeStream. */
interface ComposeOpts {
  provider: ModelProvider;
  config: EngineConfig;
  log: EngineLogger;
}

/**
 * What the setup hands back: the logger (so the caller logs the same way), the
 * trimmed catalog, the explore brief, and the compose options.
 */
interface ComposeInputs {
  log: EngineLogger;
  catalog: CappedCatalog;
  brief: string;
  composeOpts: ComposeOpts;
}

/** Build the compose options: the provider, config, and logger. */
const resolveComposeOpts = (config: EngineConfig, deps: EngineDeps): ComposeOpts => ({
  provider: deps.provider,
  config,
  log: deps.log ?? noop,
});

/**
 * Parse the diff once, build and trim the catalog (logging how much was dropped), and
 * run explore to a brief. The one parse feeds both the catalog and the changed-files
 * list. Returns the logger, the trimmed catalog, the brief, and the compose options.
 */
const prepareCompose = async (
  input: EngineInput,
  config: EngineConfig,
  deps: EngineDeps,
): Promise<ComposeInputs> => {
  const composeOpts = resolveComposeOpts(config, deps);
  const { log } = composeOpts;
  // Only explore uses the runner, so it is handled here, not in composeOpts.
  const runner = deps.run ? { run: deps.run } : {};

  const { full, catalog, changed } = deriveDiffViews(input.rawDiff, {
    maxHunks: config.maxHunks,
    maxHunkRows: config.catalog.maxHunkRows,
    maxTotalRows: config.catalog.maxTotalRows,
    maxTotalChars: config.catalog.maxTotalChars,
  });
  if (catalog.truncated) {
    log(
      `Catalog bounded for context limits: kept ${catalog.hunks.length}/${full.hunks.length} hunks, ` +
        `${catalog.rows.length}/${full.rows.length} rows; the walkthrough covers only those.`,
    );
  }
  log(`Catalog: ${catalog.hunks.length} hunks, ${catalog.rows.length} render rows.`);

  log("Exploring the repository (phase 1) ...");
  // Explore takes the same provider, config, and logger as compose, plus the runner
  // and changed files, so we reuse composeOpts as is.
  const brief = await explore(input, catalog, { ...composeOpts, ...runner, changedFiles: changed });
  return { log, catalog, brief, composeOpts };
};

export { prepareCompose };
export type { ComposeInputs, ComposeOpts, EngineDeps };
