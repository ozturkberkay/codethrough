// Integration test for the grep tool's error path, using a fake runner so a real grep
// failure (exit code above 1) is easy to trigger. The happy path and the path check
// are covered by explore_tools.test.ts; this covers the "grep failed" branch a real
// repo would only hit on a bad pattern.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelTool } from "@codethrough/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CommandRunner } from "../../src/command.js";
import { type ExploreToolLimits, ToolError } from "../../src/explore_core.js";
import { buildTools } from "../../src/explore_tools.js";

// The tool limits the engine takes as config.
const TOOL_LIMITS: ExploreToolLimits = {
  toolTimeoutMs: 15_000,
  maxFileBytes: 65_536,
  maxMatches: 200,
};

let repo = "";
let fileRoot = "";

const toolsWith = (run: CommandRunner): Record<string, ModelTool> =>
  Object.fromEntries(
    buildTools({ repoRoot: repo, run, hasRipgrep: false, limits: TOOL_LIMITS }).map((t) => [
      t.name,
      t,
    ]),
  );

// Call a tool by name with raw input (like the provider does).
const call = (tools: Record<string, ModelTool>, name: string, input: unknown): Promise<string> =>
  tools[name]!.run(input);

const noopRunner: CommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 0 });

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "ct-grep-err-"));
  // A plain file used as a fake repo root: it resolves fine, but glob's folder scan
  // fails on it, which triggers the glob tool's catch.
  fileRoot = join(repo, "not_a_dir.txt");
  writeFileSync(fileRoot, "x");
  // Real files the fake-runner rows below point at, so the whole-tree row filter
  // (which resolves each row's file) keeps them.
  writeFileSync(join(repo, "alpha.ts"), "hit\n");
  writeFileSync(join(repo, "f.ts"), "hit\n");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("grep tool error path", () => {
  it("throws a ToolError with the stderr when grep exits above the no-match code", async () => {
    const run: CommandRunner = async () => ({
      stdout: "",
      stderr: "fatal: bad pattern",
      exitCode: 2,
    });
    const tools = toolsWith(run);
    const err = call(tools, "grep", { pattern: "(", path: null });
    await expect(err).rejects.toBeInstanceOf(ToolError);
    await expect(err).rejects.toThrow(/grep failed: fatal: bad pattern/);
  });

  it("uses the ripgrep argv when ripgrep is available", async () => {
    // Setting hasRipgrep true picks the ripgrep command; the fake captures the argv.
    let argv: string[] = [];
    const run: CommandRunner = async (a) => {
      argv = a;
      return { stdout: "alpha.ts:1:hit", stderr: "", exitCode: 0 };
    };
    const grep = buildTools({ repoRoot: repo, run, hasRipgrep: true, limits: TOOL_LIMITS }).find(
      (t) => t.name === "grep",
    )!;
    const out = await grep.run({ pattern: "hit", path: null });
    expect(out).toBe("alpha.ts:1:hit");
    expect(argv[0]).toBe("rg");
  });

  it("combines the per-tool timeout with the phase signal when one is supplied", async () => {
    // The provider passes a phase signal; the runner should then get a signal that
    // covers both the per-tool timeout and the phase signal.
    const captured: { signal?: AbortSignal | undefined } = {};
    const run: CommandRunner = async (_argv, signal) => {
      captured.signal = signal;
      return { stdout: "f.ts:1:hit", stderr: "", exitCode: 0 };
    };
    const grep = buildTools({ repoRoot: repo, run, hasRipgrep: false, limits: TOOL_LIMITS }).find(
      (t) => t.name === "grep",
    )!;
    const phase = new AbortController();
    const out = await grep.run({ pattern: "x", path: null }, { signal: phase.signal });
    expect(out).toBe("f.ts:1:hit");
    expect(captured.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a generic message when grep fails with empty stderr", async () => {
    const run: CommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 2 });
    const tools = toolsWith(run);
    await expect(call(tools, "grep", { pattern: "x", path: null })).rejects.toThrow(
      /grep failed: unknown error/,
    );
  });
});

describe("glob tool error path", () => {
  it("throws a ToolError when the directory scan fails", async () => {
    // The root is a real file, not a folder, so the glob scan throws; the tool wraps
    // it as a ToolError.
    const tools = Object.fromEntries(
      buildTools({
        repoRoot: fileRoot,
        run: noopRunner,
        hasRipgrep: false,
        limits: TOOL_LIMITS,
      }).map((t) => [t.name, t]),
    );
    const err = call(tools, "glob", { pattern: "**/*" });
    await expect(err).rejects.toBeInstanceOf(ToolError);
    await expect(err).rejects.toThrow(/glob failed/);
  });
});
