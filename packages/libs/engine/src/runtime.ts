// Runtime edges that are hard to test because we cannot control the PATH check
// (`Bun.which` finds rg even with PATH cleared, so the no-ripgrep branch cannot be
// forced in a test). Kept here so the logic in the phase files stays easy to test;
// this file is left out of coverage and tested at the boundary instead.
//
// Filling in the default runner, logger, and config also lives here, so the
// "use the default" branches (which a test that passes everything never hits) do not
// drag down coverage.

import type { ModelProvider } from "@codethrough/model";

import type { CommandRunner, EngineLogger } from "./command.js";
import type { EngineConfig } from "./config.js";
import { runCommand } from "./shell.js";

const noop: EngineLogger = () => {};

/**
 * Options every phase accepts: a config plus injectable pieces. The provider and the
 * config are required; the CLI resolves the config and builds the provider, so the
 * engine holds no defaults and never builds a provider itself.
 */
interface PhaseOptions {
  provider: ModelProvider;
  config: EngineConfig;
  run?: CommandRunner;
  log?: EngineLogger;
}

/** The explore pieces with defaults filled in. */
interface ResolvedExploreDeps {
  provider: ModelProvider;
  config: EngineConfig;
  run: CommandRunner;
  log: EngineLogger;
  hasRipgrep: boolean;
}

/** The compose pieces with defaults filled in. */
interface ResolvedComposeDeps {
  provider: ModelProvider;
  config: EngineConfig;
  log: EngineLogger;
}

/**
 * Fill in the explore pieces: the provider plus default runner and logger, and check
 * for ripgrep. If rg is missing, we note the git grep fallback through the logger.
 */
const resolveExploreDeps = (opts: PhaseOptions): ResolvedExploreDeps => {
  const log = opts.log ?? noop;
  const hasRipgrep = Bun.which("rg") !== null;
  if (!hasRipgrep) {
    log("ripgrep (rg) not found; grep tool falling back to `git grep`.");
  }
  return {
    provider: opts.provider,
    config: opts.config,
    run: opts.run ?? runCommand,
    log,
    hasRipgrep,
  };
};

/** Fill in the compose pieces: the provider, config, and default logger. */
const resolveComposeDeps = (opts: Omit<PhaseOptions, "run">): ResolvedComposeDeps => ({
  provider: opts.provider,
  config: opts.config,
  log: opts.log ?? noop,
});

export { resolveComposeDeps, resolveExploreDeps };
export type { PhaseOptions, ResolvedComposeDeps, ResolvedExploreDeps };
