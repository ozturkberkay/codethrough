// The central Codethrough tuning config, separate from the landing config in
// index.ts. It gathers every engine and server knob that used to be a scattered
// constant or one-off env read, each with an env var, a default, and a doc, so the
// whole thing is tunable from one place.
//
// The loader layers four sources, highest first:
//   flags > env > project file > user file > defaults
// A fresh config is built each call so one call's env and flags never leak into the
// next.
//
// Secrets are never stored here: the project and user objects are trimmed to the
// keys the schema knows before loading, so a stray api key or token in a hand-edited
// file is dropped.

import convict from "convict";

/** How hard the model thinks. The subset of the SDK's effort levels we expose. */
type Effort = "low" | "high" | "max";

/** The legal effort values, shared by the schema picklist and consumers. */
const EFFORTS: readonly Effort[] = ["low", "high", "max"];

/** The resolved config: every tunable, grouped by area. */
interface CodethroughConfig {
  engine: {
    /** AI agent model id. */
    model: string;
    /** How hard the model thinks, for both phases. */
    effort: Effort;
    /** Cap on how many diff hunks to keep before the model runs. */
    max_hunks: number;
    /** Compose phase output-token budget. */
    compose_max_tokens: number;
    /** Explore phase output-token budget (smaller; it writes a short brief). */
    explore_max_tokens: number;
    /** Cap on explore tool-loop rounds. */
    explore_max_iterations: number;
    /** Time limit for the whole explore phase (ms). */
    explore_phase_timeout_ms: number;
    /** Time limit for one explore tool call (ms), e.g. a slow grep. */
    explore_tool_timeout_ms: number;
    /** Size cap (bytes) for one file read during explore. */
    explore_max_file_bytes: number;
    /** Cap on results from one explore grep or glob. */
    explore_max_matches: number;
    /** Row cap per kept hunk. */
    catalog_max_hunk_rows: number;
    /** Total row budget across kept hunks. */
    catalog_max_total_rows: number;
    /** Total character budget across kept hunks. */
    catalog_max_total_chars: number;
  };
  server: {
    /** How long an idle server waits before shutting itself down (ms). */
    idle_timeout_ms: number;
    /** How often to poll for live comments (ms). */
    comment_poll_ms: number;
  };
}

// The schema. Written once and reused: it builds each fresh config and drives the
// known-key filter, so the two cannot drift apart.
const codethroughSchema: convict.Schema<CodethroughConfig> = {
  engine: {
    model: {
      format: String,
      default: "claude-opus-4-8",
      env: "CODETHROUGH_MODEL",
      doc: "Anthropic model id both the explore and compose phases run against.",
    },
    effort: {
      format: [...EFFORTS],
      default: "high",
      env: "CODETHROUGH_EFFORT",
      doc: "Reasoning effort for both LLM phases: low | high | max.",
    },
    max_hunks: {
      format: "nat",
      default: 60,
      env: "CODETHROUGH_MAX_HUNKS",
      doc: "Hunk-count cap applied to the catalog before the LLM phases.",
    },
    compose_max_tokens: {
      format: "nat",
      default: 64_000,
      env: "CODETHROUGH_COMPOSE_MAX_TOKENS",
      doc: "Compose phase output-token budget; large because high effort spends tokens on thinking.",
    },
    explore_max_tokens: {
      format: "nat",
      default: 16_000,
      env: "CODETHROUGH_EXPLORE_MAX_TOKENS",
      doc: "Explore phase output-token budget; smaller, as it emits only a short brief.",
    },
    explore_max_iterations: {
      format: "nat",
      default: 30,
      env: "CODETHROUGH_EXPLORE_MAX_ITERATIONS",
      doc: "Explore tool-use loop iteration cap, so the phase can never hang.",
    },
    explore_phase_timeout_ms: {
      format: "nat",
      default: 600_000,
      env: "CODETHROUGH_EXPLORE_PHASE_TIMEOUT_MS",
      doc: "Explore whole-phase wall-clock bound in milliseconds.",
    },
    explore_tool_timeout_ms: {
      format: "nat",
      default: 15_000,
      env: "CODETHROUGH_EXPLORE_TOOL_TIMEOUT_MS",
      doc: "Per explore tool-call timeout in milliseconds (e.g. a slow grep).",
    },
    explore_max_file_bytes: {
      format: "nat",
      default: 65_536,
      env: "CODETHROUGH_EXPLORE_MAX_FILE_BYTES",
      doc: "read_file size cap in bytes for the explore phase.",
    },
    explore_max_matches: {
      format: "nat",
      default: 200,
      env: "CODETHROUGH_EXPLORE_MAX_MATCHES",
      doc: "grep/glob result-count cap for the explore phase.",
    },
    catalog_max_hunk_rows: {
      format: "nat",
      default: 400,
      env: "CODETHROUGH_CATALOG_MAX_HUNK_ROWS",
      doc: "Per-hunk row cap when bounding the catalog for context limits.",
    },
    catalog_max_total_rows: {
      format: "nat",
      default: 6_000,
      env: "CODETHROUGH_CATALOG_MAX_TOTAL_ROWS",
      doc: "Total row budget across kept hunks when bounding the catalog.",
    },
    catalog_max_total_chars: {
      format: "nat",
      default: 400_000,
      env: "CODETHROUGH_CATALOG_MAX_TOTAL_CHARS",
      doc: "Total content-character budget across kept hunks (a proxy for prompt tokens).",
    },
  },
  server: {
    idle_timeout_ms: {
      format: "nat",
      default: 1_800_000,
      env: "CODETHROUGH_IDLE_TIMEOUT_MS",
      doc: "Idle window before an unattended server shuts itself down, in milliseconds.",
    },
    comment_poll_ms: {
      format: "nat",
      default: 20_000,
      env: "CODETHROUGH_COMMENT_POLL_MS",
      doc: "Live-comments poll cadence in milliseconds.",
    },
  },
};

/**
 * The process env with blank entries removed. A blank value (say from a docker
 * `${VAR:-}` default) must count as unset so the default and file layers apply,
 * not as an empty string that fails the format check. Read fresh each call.
 */
const filteredEnv = (): NodeJS.ProcessEnv => {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== "") {
      out[key] = value;
    }
  }
  return out;
};

/** Flag overrides, keyed by dotted path. */
type FlagOverrides = Partial<{
  "engine.model": string;
  "engine.effort": Effort;
  "engine.max_hunks": number;
}>;

/** The sources the loader layers, highest precedence first. */
interface LoadOptions {
  flags?: FlagOverrides;
  projectConfig?: Record<string, unknown>;
  userConfig?: Record<string, unknown>;
}

// A schema node is either a leaf (it has a `default`) or a table of more nodes. The
// filter walks the schema tree to decide which is which.
const isLeaf = (node: object): boolean => Object.hasOwn(node, "default");

/**
 * Copy from `src` only the keys the schema declares, keeping the nesting. Anything
 * the schema does not know (a stray secret, an unrelated table) is dropped before
 * loading. A missing source gives back an empty object.
 */
const pickKnown = (schema: object, src: unknown): Record<string, unknown> => {
  if (src === null || typeof src !== "object") {
    return {};
  }
  const source = src as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, node] of Object.entries(schema)) {
    // Skip non-node schema entries and keys the source does not have.
    const present = node !== null && typeof node === "object" && Object.hasOwn(source, key);
    if (present && isLeaf(node)) {
      out[key] = source[key];
    } else if (present) {
      const nested = pickKnown(node, source[key]);
      if (Object.keys(nested).length > 0) {
        out[key] = nested;
      }
    }
  }
  return out;
};

/**
 * Apply the flag overrides, the highest layer. Only flags that have a value are
 * set, so an absent flag does not overwrite the lower layers with undefined.
 */
const applyFlags = (instance: convict.Config<CodethroughConfig>, flags: FlagOverrides): void => {
  for (const [path, value] of Object.entries(flags)) {
    if (value !== undefined) {
      instance.set(path as keyof FlagOverrides, value);
    }
  }
};

/**
 * Build the full config from the four layered sources. A fresh config is built each
 * call, then the layers are stacked: load the user file, the project file on top,
 * let env override both, then apply the flags on top. Validation runs last, so a
 * bad env value throws clearly and unknown file keys cannot slip through.
 */
const loadCodethroughConfig = (opts: LoadOptions = {}): CodethroughConfig => {
  const instance = convict(codethroughSchema, { env: filteredEnv() });
  instance.load(pickKnown(codethroughSchema, opts.userConfig));
  instance.load(pickKnown(codethroughSchema, opts.projectConfig));
  applyFlags(instance, opts.flags ?? {});
  instance.validate({ allowed: "strict" });
  return instance.getProperties();
};

/**
 * The plain schema defaults, with no env, flags, or files applied. An empty env is
 * passed so an env var cannot leak into the defaults.
 */
const defaultCodethroughConfig = (): CodethroughConfig =>
  convict(codethroughSchema, { env: {} }).getProperties();

export { defaultCodethroughConfig, EFFORTS, loadCodethroughConfig };
export type { CodethroughConfig, Effort, FlagOverrides, LoadOptions };
