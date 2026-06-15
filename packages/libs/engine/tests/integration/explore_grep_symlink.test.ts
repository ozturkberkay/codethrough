// Security test: the whole-tree grep must never leak the content of a file outside
// the repo root, even when a symlink inside the root points at it. This checks two
// layers:
//   1. the real rg/git-grep command (with --no-follow) does not follow the symlink;
//   2. the row filter drops any row whose file resolves outside the root, so even a
//      --follow set in the rg config file cannot leak outside content into the brief.
//
// We use a symlinked folder inside the root pointing at a sibling outside folder,
// since that is the case where `rg --follow` would emit an outside row; a fake runner
// then forces that exact row to show the filter catches it.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelTool } from "@codethrough/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CommandRunner } from "../../src/command.js";
import type { ExploreToolLimits } from "../../src/explore_core.js";
import { buildTools } from "../../src/explore_tools.js";
import { runCommand } from "../../src/shell.js";

// A token that exists only in the outside secret, so any leak is obvious.
const SECRET_TOKEN = "OUTSIDE_SECRET_TOKEN_zzz";

// The tool limits the engine takes as config.
const TOOL_LIMITS: ExploreToolLimits = {
  toolTimeoutMs: 15_000,
  maxFileBytes: 65_536,
  maxMatches: 200,
};

let repo = "";
let outside = "";

// Build the grep tool with the given runner and backend, and call it like the
// provider does.
const grepWith = (run: CommandRunner, hasRipgrep: boolean, input: unknown): Promise<string> => {
  const tools = Object.fromEntries(
    buildTools({ repoRoot: repo, run, hasRipgrep, limits: TOOL_LIMITS }).map((t) => [t.name, t]),
  ) as Record<string, ModelTool>;
  return tools["grep"]!.run(input);
};

beforeAll(() => {
  // The sibling "outside" folder holds the secret; the symlink inside the repo points
  // at it.
  outside = mkdtempSync(join(tmpdir(), "ct-grep-outside-"));
  mkdirSync(join(outside, "sub"));
  writeFileSync(join(outside, "sub", "secret.txt"), `${SECRET_TOKEN} = 1;\n`);

  repo = mkdtempSync(join(tmpdir(), "ct-grep-repo-"));
  // A file inside the repo without the token.
  writeFileSync(join(repo, "inside.ts"), "export const ordinary = 1;\n");
  // The escape: a symlink inside the repo to the outside folder holding the secret.
  symlinkSync(join(outside, "sub"), join(repo, "linkdir"));
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("grep whole-tree symlink escape", () => {
  it("real ripgrep with --no-follow does not traverse the escaping symlink", async () => {
    // We pass --no-follow, so rg never goes into the linked-out folder.
    const out = await grepWith(runCommand, true, { pattern: SECRET_TOKEN, path: null });
    expect(out).not.toContain(SECRET_TOKEN);
    expect(out).toBe("No matches.");
  });

  it("real git grep fallback does not leak the escaping symlink's target", async () => {
    const out = await grepWith(runCommand, false, { pattern: SECRET_TOKEN, path: null });
    expect(out).not.toContain(SECRET_TOKEN);
    expect(out).toBe("No matches.");
  });

  it("drops a row whose file realpaths outside the root (the --follow backstop)", async () => {
    // Pretend rg --follow emitted a row for a file reached through the symlink, which
    // resolves outside the root. The filter must drop it, leaking nothing.
    const leaking: CommandRunner = async () => ({
      stdout: `linkdir/secret.txt:1:${SECRET_TOKEN} = 1;\ninside.ts:1:export const ordinary = 1;\n`,
      stderr: "",
      exitCode: 0,
    });
    const out = await grepWith(leaking, true, { pattern: SECRET_TOKEN, path: null });
    // The outside row is dropped; the inside row stays.
    expect(out).not.toContain(SECRET_TOKEN);
    expect(out).toBe("inside.ts:1:export const ordinary = 1;");
  });

  it("drops unparseable and non-realpath-able rows, keeping only confined ones", async () => {
    // A row with no file name is dropped; a row with an empty file name (leading
    // colon) is dropped; and a row whose file does not exist is dropped too.
    const noisy: CommandRunner = async () => ({
      stdout:
        "no-colon-here\n:1:leading colon\nghost_does_not_exist.ts:1:vanished\ninside.ts:1:export const ordinary = 1;\n",
      stderr: "",
      exitCode: 0,
    });
    const out = await grepWith(noisy, true, { pattern: "x", path: null });
    expect(out).toBe("inside.ts:1:export const ordinary = 1;");
  });
});
