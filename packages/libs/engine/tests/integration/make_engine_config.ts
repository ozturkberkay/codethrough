// A test helper that builds a full EngineConfig with sensible values, plus overrides.
// The engine has no defaults, so the tests build one here. The values match the real
// config so the tests behave realistically.

import type { EngineConfig } from "../../src/config.js";

// Overrides: replace top-level values and/or merge into any group.
interface EngineConfigOverrides {
  model?: string;
  effort?: EngineConfig["effort"];
  maxHunks?: number;
  compose?: Partial<EngineConfig["compose"]>;
  explore?: Partial<EngineConfig["explore"]>;
  catalog?: Partial<EngineConfig["catalog"]>;
}

// Build a full EngineConfig for tests; `over` replaces top-level values and merges
// each group.
const makeEngineConfig = (over: EngineConfigOverrides = {}): EngineConfig => ({
  model: over.model ?? "claude-opus-4-8",
  effort: over.effort ?? "high",
  maxHunks: over.maxHunks ?? 60,
  compose: {
    maxTokens: 64_000,
    ...over.compose,
  },
  explore: {
    maxTokens: 16_000,
    maxIterations: 30,
    phaseTimeoutMs: 600_000,
    toolTimeoutMs: 15_000,
    maxFileBytes: 65_536,
    maxMatches: 200,
    ...over.explore,
  },
  catalog: {
    maxHunkRows: 400,
    maxTotalRows: 6_000,
    maxTotalChars: 400_000,
    ...over.catalog,
  },
});

export { makeEngineConfig };
export type { EngineConfigOverrides };
