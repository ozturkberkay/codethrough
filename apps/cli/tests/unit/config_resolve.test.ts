// Tests for the CLI config mapper: it lets @codethrough/config handle precedence
// and validation, then re-nests the flat result into the engine config and the
// server settings. The config package tests precedence and secret filtering; here
// we pin the flag pass-through, the re-nesting, and that a parsed file flows
// through. Env cases use vi.stubEnv since the loader reads the env.

import { defaultCodethroughConfig } from "@codethrough/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveRunConfig } from "../../src/config/config_resolve.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

// The engine config the defaults map to (the central defaults, nested).
const DEFAULT_ENGINE = {
  model: "claude-opus-4-8",
  effort: "high",
  maxHunks: 60,
  compose: { maxTokens: 64_000 },
  explore: {
    maxTokens: 16_000,
    maxIterations: 30,
    phaseTimeoutMs: 600_000,
    toolTimeoutMs: 15_000,
    maxFileBytes: 65_536,
    maxMatches: 200,
  },
  catalog: { maxHunkRows: 400, maxTotalRows: 6_000, maxTotalChars: 400_000 },
};

describe("resolveRunConfig mapping", () => {
  it("maps the central defaults into the nested EngineConfig + server knobs", () => {
    const resolved = resolveRunConfig({ flags: {} });
    expect(resolved.engine).toEqual(DEFAULT_ENGINE);
    expect(resolved.idleTimeoutMs).toBe(1_800_000);
    expect(resolved.commentPollMs).toBe(20_000);
  });

  it("keeps the engine mapping consistent with the central config defaults", () => {
    // Checks the re-nesting matches the central defaults field for field.
    const central = defaultCodethroughConfig();
    const { engine } = resolveRunConfig({ flags: {} });
    expect(engine.maxHunks).toBe(central.engine.max_hunks);
    expect(engine.compose.maxTokens).toBe(central.engine.compose_max_tokens);
    expect(engine.explore.maxFileBytes).toBe(central.engine.explore_max_file_bytes);
    expect(engine.catalog.maxTotalChars).toBe(central.engine.catalog_max_total_chars);
  });

  it("passes the model + effort flags through to the engine config", () => {
    const resolved = resolveRunConfig({ flags: { model: "flag-model", effort: "max" } });
    expect(resolved.engine.model).toBe("flag-model");
    expect(resolved.engine.effort).toBe("max");
  });

  it("maps a project file's engine + server knobs", () => {
    const project = {
      engine: { max_hunks: 7, explore_max_matches: 12 },
      server: { idle_timeout_ms: 123, comment_poll_ms: 456 },
    };
    const resolved = resolveRunConfig({ flags: {}, project });
    expect(resolved.engine.maxHunks).toBe(7);
    expect(resolved.engine.explore.maxMatches).toBe(12);
    expect(resolved.idleTimeoutMs).toBe(123);
    expect(resolved.commentPollMs).toBe(456);
  });

  it("lets the project file outrank the user file", () => {
    const user = { engine: { model: "user-model" } };
    const project = { engine: { model: "project-model" } };
    const resolved = resolveRunConfig({ flags: {}, project, user });
    expect(resolved.engine.model).toBe("project-model");
  });

  it("drops a secret-shaped key in a config file (keychain is the only secret source)", () => {
    const project = {
      engine: { model: "m", api_key: "sk-should-be-dropped" },
    } as Record<string, unknown>;
    const resolved = resolveRunConfig({ flags: {}, project });
    expect(resolved.engine.model).toBe("m");
    expect(JSON.stringify(resolved)).not.toContain("sk-should-be-dropped");
  });

  it("lets CODETHROUGH_MAX_HUNKS env override a project file, mapped to maxHunks", () => {
    // The loader reads the env directly. This checks env beats the project file all
    // the way through the mapper.
    vi.stubEnv("CODETHROUGH_MAX_HUNKS", "5");
    const resolved = resolveRunConfig({ flags: {}, project: { engine: { max_hunks: 20 } } });
    expect(resolved.engine.maxHunks).toBe(5);
  });

  it("throws on an invalid CODETHROUGH_EFFORT env value", () => {
    vi.stubEnv("CODETHROUGH_EFFORT", "extreme");
    expect(() => resolveRunConfig({ flags: {} })).toThrow(/effort/);
  });
});
