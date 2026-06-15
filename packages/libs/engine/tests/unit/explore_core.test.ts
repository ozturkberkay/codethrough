// Tests for the explore helpers that have no I/O: the path-safety check, the result
// caps and slices, the grep command builders, and the prompt. No file reads, no API
// key, no network.

import { describe, expect, it } from "vitest";

import {
  capLines,
  capText,
  gitGrepCommand,
  isWithinRoot,
  ripgrepCommand,
  sliceLines,
} from "../../src/explore_core.js";
import { buildExplorePrompt } from "../../src/explore_prompt.js";
import type { HunkCatalog } from "../../src/hunk_catalog.js";
import type { EngineInput } from "../../src/types.js";

describe("isWithinRoot", () => {
  it("accepts the root itself", () => {
    expect(isWithinRoot("/repo", "/repo")).toBe(true);
  });

  it("accepts a nested path under the root", () => {
    expect(isWithinRoot("/repo", "/repo/src/a.ts")).toBe(true);
  });

  it("rejects a parent of the root", () => {
    expect(isWithinRoot("/repo", "/etc/passwd")).toBe(false);
  });

  it("rejects a sibling that shares a name prefix", () => {
    // "/repo-evil" starts with "/repo" as text but is not inside it.
    expect(isWithinRoot("/repo", "/repo-evil/secret")).toBe(false);
  });
});

describe("capText", () => {
  it("returns text unchanged when under the cap", () => {
    expect(capText("hello", 1024)).toBe("hello");
  });

  it("truncates and marks text over the cap", () => {
    const out = capText("abcdefghij", 4);
    expect(out.startsWith("abcd")).toBe(true);
    expect(out).toContain("[truncated at 4 bytes]");
  });
});

describe("sliceLines", () => {
  const text = "l1\nl2\nl3\nl4";

  it("returns the whole text when no bounds are given", () => {
    expect(sliceLines(text, null, null)).toBe(text);
  });

  it("returns an inclusive 1-based slice", () => {
    expect(sliceLines(text, 2, 3)).toBe("l2\nl3");
  });

  it("clamps an over-long end to the last line", () => {
    expect(sliceLines(text, 3, 99)).toBe("l3\nl4");
  });

  it("returns empty when start is past the end of the file", () => {
    expect(sliceLines(text, 10, 20)).toBe("");
  });

  it("defaults the start to line 1 when only an end is given", () => {
    expect(sliceLines(text, null, 2)).toBe("l1\nl2");
  });

  it("defaults the end to the last line when only a start is given", () => {
    expect(sliceLines(text, 3, null)).toBe("l3\nl4");
  });
});

describe("capLines", () => {
  it("reports an empty result clearly", () => {
    expect(capLines([], 5)).toBe("No matches.");
  });

  it("joins all lines when under the cap", () => {
    expect(capLines(["a", "b"], 5)).toBe("a\nb");
  });

  it("caps and notes how many were omitted", () => {
    const out = capLines(["a", "b", "c", "d"], 2);
    expect(out).toBe("a\nb\n... [2 more omitted]");
  });
});

describe("grep command builders", () => {
  it("builds a git grep argv that ends flag parsing before the pattern", () => {
    // -e lets the pattern start with a dash; --no-index searches the working tree.
    expect(gitGrepCommand("/repo", "-x", "src")).toEqual([
      "git",
      "-C",
      "/repo",
      "grep",
      "--no-index",
      "-I",
      "-n",
      "-e",
      "-x",
      "--",
      "src",
    ]);
  });

  it("omits the path separator when no path is given", () => {
    expect(gitGrepCommand("/repo", "foo")).toEqual([
      "git",
      "-C",
      "/repo",
      "grep",
      "--no-index",
      "-I",
      "-n",
      "-e",
      "foo",
    ]);
  });

  it("builds a ripgrep argv rooted at the repo when no path is given", () => {
    // --no-follow is set here so a --follow in the rg config file cannot escape.
    expect(ripgrepCommand("/repo", "foo")).toEqual([
      "rg",
      "--no-heading",
      "--no-follow",
      "-n",
      "-e",
      "foo",
      "/repo",
    ]);
  });

  it("targets the given path with ripgrep", () => {
    expect(ripgrepCommand("/repo", "foo", "/repo/src")).toEqual([
      "rg",
      "--no-heading",
      "--no-follow",
      "-n",
      "-e",
      "foo",
      "/repo/src",
    ]);
  });
});

describe("buildExplorePrompt", () => {
  // A small modify diff, so the changed-files list comes from the diff itself.
  const rawDiff = `diff --git a/src/client.ts b/src/client.ts
index 1111111..2222222 100644
--- a/src/client.ts
+++ b/src/client.ts
@@ -1,1 +1,1 @@
-const x = 0;
+const x = 1;
`;
  const input: EngineInput = {
    repoRoot: "/repo",
    rawDiff,
    meta: {
      title: "Add retry wrapper",
      body: "Wraps the client in retries.",
      baseRef: "main",
      headRef: "feat/retry",
    },
  };
  const catalog: HunkCatalog = {
    hunks: [
      {
        id: "h0",
        file: "src/client.ts",
        status: "modified",
        lines: [{ line: 1, content: "const x = 1;" }],
      },
    ],
    rows: [],
  };

  it("includes the PR metadata, changed files, and the hunk catalog", () => {
    const prompt = buildExplorePrompt(input, catalog);
    expect(prompt).toContain("Add retry wrapper");
    expect(prompt).toContain("Base: main  Head: feat/retry");
    expect(prompt).toContain("src/client.ts (MODIFIED, +1/-1)");
    expect(prompt).toContain("### h0 (src/client.ts, modified)");
    expect(prompt).toContain("1: const x = 1;");
  });

  it("nudges for concrete findings and minimum breadth", () => {
    const prompt = buildExplorePrompt(input, catalog);
    expect(prompt).toMatch(/CONCRETE findings/);
    expect(prompt).toMatch(/at least one caller or test/);
  });

  it("substitutes a placeholder for an empty PR body", () => {
    const prompt = buildExplorePrompt({ ...input, meta: { ...input.meta, body: "" } }, catalog);
    expect(prompt).toContain("(no description provided)");
  });

  it("substitutes a placeholder when the diff has no files", () => {
    const prompt = buildExplorePrompt({ ...input, rawDiff: "" }, { hunks: [], rows: [] });
    expect(prompt).toContain("(none reported)");
    expect(prompt).toContain("(catalog is empty)");
  });
});
