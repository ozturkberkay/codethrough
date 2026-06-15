// Tests for the central config loader: the precedence order (flags > env > project
// file > user file > defaults), env validation, the secret and unknown-key filter,
// and the plain defaults. Env is set with vi.stubEnv and cleared after each test so
// the layers do not leak between cases.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type CodethroughConfig,
  defaultCodethroughConfig,
  EFFORTS,
  type FlagOverrides,
  loadCodethroughConfig,
} from "../../src/codethrough.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("defaultCodethroughConfig", () => {
  it("returns the declared defaults regardless of the environment", () => {
    // An env var must not leak into the defaults.
    vi.stubEnv("CODETHROUGH_MODEL", "env-model");
    vi.stubEnv("CODETHROUGH_MAX_HUNKS", "5");
    const defaults = defaultCodethroughConfig();

    expect(defaults.engine.model).toBe("claude-opus-4-8");
    expect(defaults.engine.effort).toBe("high");
    expect(defaults.engine.max_hunks).toBe(60);
    expect(defaults.engine.compose_max_tokens).toBe(64_000);
    expect(defaults.engine.explore_max_tokens).toBe(16_000);
    expect(defaults.engine.explore_max_iterations).toBe(30);
    expect(defaults.engine.explore_phase_timeout_ms).toBe(600_000);
    expect(defaults.engine.explore_tool_timeout_ms).toBe(15_000);
    expect(defaults.engine.explore_max_file_bytes).toBe(65_536);
    expect(defaults.engine.explore_max_matches).toBe(200);
    expect(defaults.engine.catalog_max_hunk_rows).toBe(400);
    expect(defaults.engine.catalog_max_total_rows).toBe(6_000);
    expect(defaults.engine.catalog_max_total_chars).toBe(400_000);
    expect(defaults.server.idle_timeout_ms).toBe(1_800_000);
    expect(defaults.server.comment_poll_ms).toBe(20_000);
  });

  it("exposes the legal effort picklist", () => {
    expect(EFFORTS).toEqual(["low", "high", "max"]);
  });
});

describe("loadCodethroughConfig precedence", () => {
  // One key is set at all five layers, then we peel away the top layer each step and
  // check the new winner: flags > env > project > user > default.
  it("layers flags > env > project > user > default for one key", () => {
    const userConfig = { engine: { model: "user-model" } };
    const projectConfig = { engine: { model: "project-model" } };

    // Default only (no flags, env, or files).
    expect(loadCodethroughConfig().engine.model).toBe("claude-opus-4-8");

    // User file beats the default.
    expect(loadCodethroughConfig({ userConfig }).engine.model).toBe("user-model");

    // Project file beats the user file.
    expect(loadCodethroughConfig({ userConfig, projectConfig }).engine.model).toBe("project-model");

    // Env beats both files.
    vi.stubEnv("CODETHROUGH_MODEL", "env-model");
    expect(loadCodethroughConfig({ userConfig, projectConfig }).engine.model).toBe("env-model");

    // A flag beats env and everything below it.
    expect(
      loadCodethroughConfig({ flags: { "engine.model": "flag-model" }, userConfig, projectConfig })
        .engine.model,
    ).toBe("flag-model");
  });

  it("treats a blank CODETHROUGH_* env var as unset", () => {
    // A blank value (say from a docker `${VAR:-}` default) must fall through to the
    // file and default layers, not fail the format or override them.
    vi.stubEnv("CODETHROUGH_MODEL", "");
    const config = loadCodethroughConfig({ projectConfig: { engine: { model: "project-model" } } });
    expect(config.engine.model).toBe("project-model");
  });

  it("skips a flag whose value is undefined (does not clobber lower layers)", () => {
    // An undefined flag value must be ignored so the project file still wins. The
    // flags object is typed loosely here because strict options forbid an explicit
    // undefined.
    const flags = { "engine.model": undefined } as unknown as FlagOverrides;
    const config = loadCodethroughConfig({
      flags,
      projectConfig: { engine: { model: "project-model" } },
    });
    expect(config.engine.model).toBe("project-model");
  });

  it("flows CODETHROUGH_MAX_HUNKS=5 and CODETHROUGH_EFFORT=low through end to end", () => {
    // Shows two env vars flowing through the one loader into the typed config.
    vi.stubEnv("CODETHROUGH_MAX_HUNKS", "5");
    vi.stubEnv("CODETHROUGH_EFFORT", "low");
    const config = loadCodethroughConfig({ flags: {} });

    expect(config.engine.max_hunks).toBe(5);
    expect(config.engine.effort).toBe("low");
  });
});

describe("loadCodethroughConfig env validation", () => {
  it("parses a numeric CODETHROUGH_MAX_HUNKS as a number (nat format)", () => {
    vi.stubEnv("CODETHROUGH_MAX_HUNKS", "42");
    const value = loadCodethroughConfig().engine.max_hunks;
    expect(value).toBe(42);
    expect(typeof value).toBe("number");
  });

  it("throws on an out-of-picklist CODETHROUGH_EFFORT", () => {
    vi.stubEnv("CODETHROUGH_EFFORT", "extreme");
    // Validation rejects a value outside the allowed list, naming the field.
    expect(() => loadCodethroughConfig()).toThrow(/effort/);
  });

  it("throws on a non-numeric CODETHROUGH_MAX_HUNKS", () => {
    vi.stubEnv("CODETHROUGH_MAX_HUNKS", "abc");
    expect(() => loadCodethroughConfig()).toThrow(/max_hunks/);
  });
});

describe("loadCodethroughConfig key filtering", () => {
  it("drops a secret-shaped leaf from a hand-edited project object", () => {
    // An api_key under the engine table is not in the schema, so it must be dropped
    // before loading and must never reach the resolved config.
    const projectConfig = {
      engine: { model: "project-model", api_key: "sk-should-be-dropped" },
    } as Record<string, unknown>;
    const config = loadCodethroughConfig({ projectConfig });

    expect(config.engine.model).toBe("project-model");
    expect(JSON.stringify(config)).not.toContain("sk-should-be-dropped");
  });

  it("drops an entire unknown table from a config object", () => {
    const projectConfig = {
      engine: { max_hunks: 7 },
      secrets: { token: "gho-should-be-dropped" },
    } as Record<string, unknown>;
    const config = loadCodethroughConfig({ projectConfig });

    expect(config.engine.max_hunks).toBe(7);
    expect(JSON.stringify(config)).not.toContain("gho-should-be-dropped");
    expect(config).not.toHaveProperty("secrets");
  });

  it("ignores a non-object source (null / primitive) and uses lower layers", () => {
    // A bad parse (say a file that parsed to a single value) must not throw; it
    // counts as an absent source so the defaults apply.
    const config = loadCodethroughConfig({
      projectConfig: null as unknown as Record<string, unknown>,
      userConfig: 42 as unknown as Record<string, unknown>,
    });
    expect(config.engine.model).toBe("claude-opus-4-8");
  });

  it("ignores an engine value that is itself not an object", () => {
    // The nested-table path must cope with `engine` being a single value in a bad file.
    const projectConfig = { engine: "not-a-table" } as unknown as Record<string, unknown>;
    const config = loadCodethroughConfig({ projectConfig });
    expect(config.engine.model).toBe("claude-opus-4-8");
  });

  it("maps the whole surface from the project file when fully specified", () => {
    // Shows every known key is picked through and the full shape round-trips.
    const projectConfig: {
      engine: CodethroughConfig["engine"];
      server: CodethroughConfig["server"];
    } = {
      engine: {
        model: "m",
        effort: "max",
        max_hunks: 1,
        compose_max_tokens: 2,
        explore_max_tokens: 3,
        explore_max_iterations: 4,
        explore_phase_timeout_ms: 5,
        explore_tool_timeout_ms: 6,
        explore_max_file_bytes: 7,
        explore_max_matches: 8,
        catalog_max_hunk_rows: 9,
        catalog_max_total_rows: 10,
        catalog_max_total_chars: 11,
      },
      server: { idle_timeout_ms: 12, comment_poll_ms: 13 },
    };
    const config = loadCodethroughConfig({ projectConfig });
    expect(config).toEqual(projectConfig);
  });
});
