// Integration tests for runEngine: the full
// build catalog -> trim catalog -> explore -> compose -> check steps sequence with a
// fake provider and a no-op runner, so it runs without a network. Shows the phases are
// wired together, the catalog is trimmed before the model phases, bad steps are
// dropped, and progress is logged through the injected logger.

import type { Walkthrough } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import type { CommandRunner } from "../../src/command.js";
import { runEngine } from "../../src/run.js";
import type { EngineInput } from "../../src/types.js";
import { fakeProvider } from "./fake_provider.js";
import { makeEngineConfig } from "./make_engine_config.js";

const ENGINE_CONFIG = makeEngineConfig();

// Two single-line added files give two hunks, h0 and h1.
const TWO_HUNKS = `diff --git a/a.ts b/a.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/a.ts
@@ -0,0 +1,1 @@
+const a = 1;
diff --git a/b.ts b/b.ts
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/b.ts
@@ -0,0 +1,1 @@
+const b = 2;
`;

const input: EngineInput = {
  repoRoot: "/repo",
  rawDiff: TWO_HUNKS,
  meta: { title: "t", body: "b", baseRef: "main", headRef: "feature" },
};

const noopRunner: CommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 0 });

const walkthrough: Walkthrough = {
  summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d"] },
  steps: [
    { order: 2, hunkId: "h1", lineRange: null, title: "second", explanation: "e" },
    { order: 1, hunkId: "h0", lineRange: null, title: "first", explanation: "e" },
  ],
};

// A provider that returns the brief then streams the given walkthrough JSON.
const engineProvider = (w: unknown, stopReason?: "max_tokens"): ReturnType<typeof fakeProvider> =>
  fakeProvider({
    brief: "a brief",
    deltas: w === null ? [] : [JSON.stringify(w)],
    ...(stopReason === undefined ? {} : { stopReason }),
  });

describe("runEngine", () => {
  it("sequences the phases and returns the walkthrough, catalog, and validation", async () => {
    const provider = engineProvider(walkthrough);
    const result = await runEngine(input, ENGINE_CONFIG, { provider, run: noopRunner });

    expect(result.walkthrough).toEqual(walkthrough);
    expect(result.catalog.hunks.map((h) => h.id)).toEqual(["h0", "h1"]);
    // The validator sorted the steps by number and renumbered them 0, 1, 2.
    expect(result.validation.valid.map((s) => s.title)).toEqual(["first", "second"]);
    expect(result.validation.valid.map((s) => s.order)).toEqual([0, 1]);
  });

  it("drops steps that reference an unknown hunk id, reporting the reason", async () => {
    const withBadStep: Walkthrough = {
      summary: walkthrough.summary,
      steps: [
        { order: 1, hunkId: "h0", lineRange: null, title: "keep", explanation: "e" },
        { order: 2, hunkId: "h99", lineRange: null, title: "drop", explanation: "e" },
      ],
    };
    const logs: string[] = [];
    const provider = engineProvider(withBadStep);
    const result = await runEngine(input, ENGINE_CONFIG, {
      provider,
      run: noopRunner,
      log: (m) => logs.push(m),
    });

    expect(result.validation.valid.map((s) => s.title)).toEqual(["keep"]);
    expect(result.validation.dropped).toHaveLength(1);
    expect(logs.some((l) => /Dropped step .*h99/.test(l))).toBe(true);
  });

  it("caps the catalog before the LLM phases and logs the truncation", async () => {
    const logs: string[] = [];
    const onlyH0: Walkthrough = {
      summary: walkthrough.summary,
      steps: [{ order: 1, hunkId: "h0", lineRange: null, title: "first", explanation: "e" }],
    };
    const provider = engineProvider(onlyH0);
    const result = await runEngine(input, makeEngineConfig({ maxHunks: 1 }), {
      provider,
      run: noopRunner,
      log: (m) => logs.push(m),
    });

    expect(result.catalog.hunks.map((h) => h.id)).toEqual(["h0"]);
    expect(result.catalog.truncated).toBe(true);
    expect(logs.some((l) => /Catalog bounded/.test(l))).toBe(true);
  });

  it("logs an adjusted step when a lineRange is reset to a whole-hunk highlight", async () => {
    const badRange: Walkthrough = {
      summary: walkthrough.summary,
      // Hunk h0 has one new-side line (1), so [1,5] is out of range; the step is kept
      // but reset to highlight the whole hunk and reported as adjusted.
      steps: [{ order: 1, hunkId: "h0", lineRange: [1, 5], title: "first", explanation: "e" }],
    };
    const logs: string[] = [];
    const provider = engineProvider(badRange);
    const result = await runEngine(input, ENGINE_CONFIG, {
      provider,
      run: noopRunner,
      log: (m) => logs.push(m),
    });

    expect(result.validation.adjusted).toHaveLength(1);
    expect(result.validation.valid[0]!.lineRange).toBeNull();
    expect(logs.some((l) => /whole-hunk highlight/.test(l))).toBe(true);
  });

  it("propagates a compose failure (max_tokens) as an error", async () => {
    const provider = engineProvider(null, "max_tokens");
    await expect(runEngine(input, ENGINE_CONFIG, { provider, run: noopRunner })).rejects.toThrow(
      /max_tokens/,
    );
  });

  it("runs without a logger or runner (defaults applied)", async () => {
    // With no logger or runner, explore uses the no-op logger and the real runner, but
    // the fake provider returns the brief before any tool is called.
    const provider = engineProvider(walkthrough);
    const result = await runEngine(input, ENGINE_CONFIG, { provider });
    expect(result.walkthrough).toEqual(walkthrough);
  });
});
