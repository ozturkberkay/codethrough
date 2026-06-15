// Integration tests for explore() with a fake provider, so the request the engine
// builds (prompt, tools, limits, signal), the brief return, the time-limit binding,
// and the injected logger run without a network. The tool-use loop itself lives in
// the provider package and is tested there.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { CommandRunner } from "../../src/command.js";
import { explore } from "../../src/explore.js";
import type { HunkCatalog } from "../../src/hunk_catalog.js";
import type { EngineInput } from "../../src/types.js";
import { type ExploreCapture, fakeProvider } from "./fake_provider.js";
import { makeEngineConfig } from "./make_engine_config.js";

const ENGINE_CONFIG = makeEngineConfig();

let repo = "";

const catalog: HunkCatalog = {
  hunks: [{ id: "h0", file: "a.ts", status: "modified", lines: [{ line: 1, content: "x" }] }],
  rows: [],
};

const input = (): EngineInput => ({
  repoRoot: repo,
  rawDiff: "",
  meta: { title: "t", body: "b", baseRef: "main", headRef: "feature" },
});

// A no-op runner: the fake provider returns the brief directly, so no tool is ever
// called and grep is never spawned.
const noopRunner: CommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 0 });

beforeAll(() => {
  // A real folder so resolving the root does not fail.
  repo = mkdtempSync(join(tmpdir(), "ct-explore-loop-"));
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("explore shell", () => {
  it("returns the brief the provider produced", async () => {
    const provider = fakeProvider({ brief: "final brief" });
    expect(
      await explore(input(), catalog, { provider, config: ENGINE_CONFIG, run: noopRunner }),
    ).toBe("final brief");
  });

  it("builds the request: the explore prompt, the three tools, budgets, and a signal", async () => {
    const exploreCapture: ExploreCapture = {};
    const provider = fakeProvider({ brief: "ok", exploreCapture });
    await explore(input(), catalog, { provider, config: ENGINE_CONFIG, run: noopRunner });
    const req = exploreCapture.request!;
    expect(req.prompt).toContain("exploring a code repository");
    expect(req.tools.map((t) => t.name)).toEqual(["read_file", "grep", "glob"]);
    expect(req.maxIterations).toBeGreaterThan(0);
    expect(req.maxTokens).toBeGreaterThan(0);
    expect(req.signal).toBeInstanceOf(AbortSignal);
  });

  it("logs progress through the injected logger (no console)", async () => {
    const logs: string[] = [];
    const provider = fakeProvider({ brief: "ok" });
    await explore(input(), catalog, {
      provider,
      config: ENGINE_CONFIG,
      run: noopRunner,
      log: (m) => logs.push(m),
    });
    expect(logs.some((l) => /Exploration finished/.test(l))).toBe(true);
  });

  it("binds a wall-clock timeout that aborts the request signal when it fires", async () => {
    // The engine ties a signal to a phase timer; a provider that waits on the signal
    // sees it abort once the timer fires (driven by fake timers).
    vi.useFakeTimers();
    const exploreCapture: ExploreCapture = {};
    const provider = fakeProvider({ brief: "brief", exploreWaitsForAbort: true, exploreCapture });
    const promise = explore(input(), catalog, { provider, config: ENGINE_CONFIG, run: noopRunner });
    await vi.runAllTimersAsync();
    await promise;
    const signal = exploreCapture.request!.signal!;
    expect(signal.aborted).toBe(true);
  });

  it("propagates an unexpected provider error", async () => {
    const provider = fakeProvider({ exploreError: new Error("provider blew up") });
    await expect(
      explore(input(), catalog, { provider, config: ENGINE_CONFIG, run: noopRunner }),
    ).rejects.toThrow(/provider blew up/);
  });

  it("applies the default runner and logger when only the provider is injected", async () => {
    const provider = fakeProvider({ brief: "brief" });
    expect(await explore(input(), catalog, { provider, config: ENGINE_CONFIG })).toBe("brief");
  });
});
