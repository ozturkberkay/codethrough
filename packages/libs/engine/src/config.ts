// The config the engine is given, fully resolved. The engine has no defaults and
// reads no env for these; the CLI works out the values and passes them in. Each phase
// reads its part, so there are no hardcoded numbers left in the engine.

/** How hard the model thinks. */
type Effort = "low" | "high" | "max";

/** The settings the phases read, grouped by phase. */
interface EngineConfig {
  /** Model id, e.g. "claude-opus-4-8". */
  model: string;
  /** Thinking effort for both phases. */
  effort: Effort;
  /** Most hunks to keep before the model phases. */
  maxHunks: number;
  /** Compose (phase 2) settings. */
  compose: {
    /** Output-token budget. */
    maxTokens: number;
  };
  /** Explore (phase 1) settings. */
  explore: {
    /** Output-token budget (small; it writes a short brief). */
    maxTokens: number;
    /** Most loop turns, so the phase cannot hang. */
    maxIterations: number;
    /** Time limit for the whole phase (ms). */
    phaseTimeoutMs: number;
    /** Time limit for one tool call (ms), e.g. a slow grep. */
    toolTimeoutMs: number;
    /** How much of a file to read (bytes). */
    maxFileBytes: number;
    /** Most results to return from a grep or glob. */
    maxMatches: number;
  };
  /** Catalog-trimming limits applied before the model phases. */
  catalog: {
    /** Most rows to keep in one hunk. */
    maxHunkRows: number;
    /** Most rows to keep across all hunks. */
    maxTotalRows: number;
    /** Most characters to keep across all hunks. */
    maxTotalChars: number;
  };
}

export type { Effort, EngineConfig };
