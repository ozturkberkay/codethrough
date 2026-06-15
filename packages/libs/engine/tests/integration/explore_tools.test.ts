// Integration tests for the phase 1 read-only tools on a throwaway fixture repo. No
// API key or network: we call each tool's `run` directly with the real runner. Runs
// under Bun. The tool-use loop is tested separately with a fake.
//
// The fixture has a normal file, a nested file, and a symlink pointing outside the
// repo, so we can show the tools block both `../` escapes and symlink escapes.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelTool } from "@codethrough/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ExploreToolLimits, ToolError } from "../../src/explore_core.js";
import { buildTools } from "../../src/explore_tools.js";
import { runCommand } from "../../src/shell.js";

// The tool limits the engine takes as config: a 15s per-tool timeout, a 64 KiB read
// cap, a 200-row match cap.
const TOOL_LIMITS: ExploreToolLimits = {
  toolTimeoutMs: 15_000,
  maxFileBytes: 65_536,
  maxMatches: 200,
};

let repo = "";
let outside = "";
let tools: Record<string, ModelTool> = {};

// Call a tool by name with raw input (like the provider does).
const call = (name: string, input: unknown): Promise<string> => tools[name]!.run(input);

beforeAll(() => {
  // A sibling "outside" folder holds the secret a symlink will try to reach.
  outside = mkdtempSync(join(tmpdir(), "ct-outside-"));
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET\n");

  repo = mkdtempSync(join(tmpdir(), "ct-repo-"));
  writeFileSync(join(repo, "alpha.ts"), "export const needle = 1;\nconst other = 2;\n");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "beta.ts"), "import { needle } from '../alpha';\nneedle;\n");
  // A symlink inside the repo pointing outside it (the escape we must block).
  symlinkSync(join(outside, "secret.txt"), join(repo, "escape.txt"));

  tools = Object.fromEntries(
    buildTools({ repoRoot: repo, run: runCommand, hasRipgrep: false, limits: TOOL_LIMITS }).map(
      (t) => [t.name, t],
    ),
  );
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("read_file", () => {
  it("returns full file content for a sandboxed path", async () => {
    const out = await call("read_file", { path: "alpha.ts", startLine: null, endLine: null });
    expect(out).toBe("export const needle = 1;\nconst other = 2;\n");
  });

  it("returns only the requested line slice", async () => {
    const out = await call("read_file", { path: "alpha.ts", startLine: 2, endLine: 2 });
    expect(out).toBe("const other = 2;");
  });

  it("enforces the size cap with a truncation marker", async () => {
    const big = "x".repeat(200 * 1024);
    writeFileSync(join(repo, "big.txt"), big);
    const out = await call("read_file", { path: "big.txt", startLine: null, endLine: null });
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain("[truncated at");
  });

  it("rejects a parent-traversal path as outside the repository", async () => {
    // Points above the root; must be refused as outside, not just missing.
    await expect(
      call("read_file", { path: "../../../../etc/hosts", startLine: null, endLine: null }),
    ).rejects.toThrow(/outside the repository/);
  });

  it("rejects a symlink whose target is outside the repo", async () => {
    // The escape.txt symlink points at the outside secret; resolving it exposes that.
    const err = call("read_file", { path: "escape.txt", startLine: null, endLine: null });
    await expect(err).rejects.toBeInstanceOf(ToolError);
    await expect(err).rejects.toThrow(/outside the repository/);
  });

  it("reports a clear error for a missing file inside the repo", async () => {
    await expect(
      call("read_file", { path: "does_not_exist.ts", startLine: null, endLine: null }),
    ).rejects.toThrow(/not found/);
  });

  it("rejects a path that is both missing AND outside the repo as outside", async () => {
    // The file does not exist and the path points outside the root, so it is refused
    // as outside rather than just reported missing.
    await expect(
      call("read_file", {
        path: "../../no_such_dir_xyz/ghost.ts",
        startLine: null,
        endLine: null,
      }),
    ).rejects.toThrow(/outside the repository/);
  });
});

describe("grep (git grep fallback)", () => {
  it("returns matching file:line:content rows", async () => {
    const out = await call("grep", { pattern: "needle", path: null });
    expect(out).toContain("alpha.ts:1:export const needle = 1;");
    expect(out).toContain("src/beta.ts");
  });

  it("restricts to a sandboxed path when given", async () => {
    const out = await call("grep", { pattern: "needle", path: "src" });
    expect(out).toContain("src/beta.ts");
    expect(out).not.toContain("alpha.ts:");
  });

  it("returns a clear no-match result rather than an error", async () => {
    const out = await call("grep", { pattern: "zzz_no_such_token", path: null });
    expect(out).toBe("No matches.");
  });

  it("rejects a path that escapes the repo", async () => {
    await expect(call("grep", { pattern: "x", path: "../.." })).rejects.toBeInstanceOf(ToolError);
  });
});

describe("glob", () => {
  it("lists files matching a pattern, relative to the repo root", async () => {
    const out = await call("glob", { pattern: "**/*.ts" });
    const paths = out.split("\n").toSorted();
    expect(paths).toContain("alpha.ts");
    expect(paths).toContain("src/beta.ts");
  });

  it("does not match files outside the pattern", async () => {
    const out = await call("glob", { pattern: "src/*.ts" });
    expect(out).toBe("src/beta.ts");
  });

  it("does not list files outside the repo via a parent-traversal pattern", async () => {
    // Without the filter, glob would list the sibling "outside" folder; the filter
    // must drop matches that land outside the root. A narrow pattern keeps the scan
    // off system folders.
    const outsideName = outside.split("/").pop()!;
    const out = await call("glob", { pattern: `../${outsideName}/*.txt` });
    expect(out).not.toContain("secret.txt");
    expect(out).toBe("No matches.");
  });
});
