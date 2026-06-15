// Load the run's config from @codethrough/config and reshape it for the CLI. The
// loader owns the precedence
//
//   flags > env > project (.codethrough.toml) > user (config.toml) > defaults
//
// plus the env settings, defaults, and validation; this only maps the flags into
// the loader's shape and re-nests the flat result into the engine config and the
// server settings. Parsing the TOML text is the shell's job.
//
// SECRETS NEVER COME FROM CONFIG: the loader keeps only known keys, so a token in a
// hand-edited file is dropped. The keychain is the only secret source.

import { type CodethroughConfig, type Effort, loadCodethroughConfig } from "@codethrough/config";
import type { EngineConfig } from "@codethrough/engine";

// The overrides taken from the flags (only model and effort today; the rest come
// from env, files, or defaults).
interface FlagOverrides {
  model?: string;
  effort?: Effort;
}

// The inputs: the flags plus the two parsed config files (or undefined when
// absent). The loader reads the env itself.
interface ResolveInputs {
  flags: FlagOverrides;
  project?: Record<string, unknown>;
  user?: Record<string, unknown>;
}

// The resolved config the CLI uses: the nested engine config and the server
// settings (idle window and poll interval).
interface ResolvedRunConfig {
  engine: EngineConfig;
  idleTimeoutMs: number;
  commentPollMs: number;
}

// Map the flags to the loader's shape, including only the ones that are set so an
// absent flag never overrides a lower layer.
const toLoaderFlags = (flags: FlagOverrides): Parameters<typeof loadCodethroughConfig>[0] => {
  const out: NonNullable<Parameters<typeof loadCodethroughConfig>[0]>["flags"] = {};
  if (flags.model !== undefined) {
    out["engine.model"] = flags.model;
  }
  if (flags.effort !== undefined) {
    out["engine.effort"] = flags.effort;
  }
  return { flags: out };
};

// Re-nest the flat engine settings into the engine's nested config.
const toEngineConfig = (config: CodethroughConfig): EngineConfig => {
  const { engine } = config;
  return {
    model: engine.model,
    effort: engine.effort,
    maxHunks: engine.max_hunks,
    compose: { maxTokens: engine.compose_max_tokens },
    explore: {
      maxTokens: engine.explore_max_tokens,
      maxIterations: engine.explore_max_iterations,
      phaseTimeoutMs: engine.explore_phase_timeout_ms,
      toolTimeoutMs: engine.explore_tool_timeout_ms,
      maxFileBytes: engine.explore_max_file_bytes,
      maxMatches: engine.explore_max_matches,
    },
    catalog: {
      maxHunkRows: engine.catalog_max_hunk_rows,
      maxTotalRows: engine.catalog_max_total_rows,
      maxTotalChars: engine.catalog_max_total_chars,
    },
  };
};

// Resolve the config: load it with the layered sources, then map it to the engine
// config and the server settings. The loader applies env and validation, so a bad
// env value throws here.
const resolveRunConfig = (inputs: ResolveInputs): ResolvedRunConfig => {
  const config = loadCodethroughConfig({
    ...toLoaderFlags(inputs.flags),
    ...(inputs.project === undefined ? {} : { projectConfig: inputs.project }),
    ...(inputs.user === undefined ? {} : { userConfig: inputs.user }),
  });
  return {
    engine: toEngineConfig(config),
    idleTimeoutMs: config.server.idle_timeout_ms,
    commentPollMs: config.server.comment_poll_ms,
  };
};

export { resolveRunConfig };
export type { FlagOverrides, ResolveInputs, ResolvedRunConfig };
