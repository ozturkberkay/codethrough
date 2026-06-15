// Tests against a small hand-crafted fixture that deliberately covers every
// placement scenario. The diff has a few hunks across three files (including one
// without a trailing newline, to exercise the phantom-newline filter); the
// comments name their intent in `body`. This is clearer and far smaller than the
// old raw GitHub API dumps it replaced.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "valibot";
import { Comment } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { buildCommentDiffIndex, findRow } from "../../src/comment_diff_index.js";
import { placeAll } from "../../src/comment_placement.js";
import type { GhReviewComment } from "../../src/gh_review_comment.js";

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const loadText = (name: string): string => readFileSync(fixturePath(name), "utf8");

const diff = loadText("synthetic.diff");
const comments = JSON.parse(loadText("synthetic_comments.json")) as GhReviewComment[];

const index = buildCommentDiffIndex(diff);
const placed = placeAll(index, comments);
const byId = new Map(placed.map((c) => [c.id, c]));

// The placement of one comment, looked up by its fixture id.
const placementOf = (id: number) => byId.get(String(id))?.placement;

describe("synthetic fixture: placement census", () => {
  it("places every comment and validates against the schema", () => {
    expect(placed.length).toBe(comments.length);
    for (const c of placed) {
      expect(() => parse(Comment, c)).not.toThrow();
    }
  });

  it("produces the exact count of each strategy", () => {
    const census: Record<string, number> = {};
    for (const c of placed) {
      census[c.placement.strategy] = (census[c.placement.strategy] ?? 0) + 1;
    }

    expect(census).toEqual({
      exact: 4,
      "anchored-additions": 2,
      "anchored-deletions": 1,
      "outdated-historical": 1,
      "outdated-unplaceable": 1,
      "file-note": 1,
    });
  });
});

describe("synthetic fixture: per-comment placement", () => {
  it("pins an added line exactly on the additions side (id 101)", () => {
    expect(placementOf(101)).toEqual({
      kind: "line",
      strategy: "exact",
      side: "additions",
      lineNumber: 2,
      spanStartLine: null,
    });
  });

  it("pins a deleted line exactly on the deletions side (id 102)", () => {
    expect(placementOf(102)).toEqual({
      kind: "line",
      strategy: "exact",
      side: "deletions",
      lineNumber: 2,
      spanStartLine: null,
    });
  });

  it("anchors a RIGHT context comment to the additions row (id 103)", () => {
    expect(placementOf(103)).toEqual({
      kind: "line",
      strategy: "anchored-additions",
      side: "additions",
      lineNumber: 4,
      spanStartLine: null,
    });
  });

  it("anchors a LEFT context comment to the deletions row (id 104)", () => {
    expect(placementOf(104)).toEqual({
      kind: "line",
      strategy: "anchored-deletions",
      side: "deletions",
      lineNumber: 3,
      spanStartLine: null,
    });
  });

  it("carries the span start and pins the end line for a multi-line comment (id 105)", () => {
    expect(placementOf(105)).toEqual({
      kind: "line",
      strategy: "anchored-additions",
      side: "additions",
      lineNumber: 6,
      spanStartLine: 5,
    });
  });

  it("re-anchors an outdated comment whose saved hunk still matches a row (id 106)", () => {
    expect(placementOf(106)).toEqual({
      kind: "line",
      strategy: "outdated-historical",
      side: "additions",
      lineNumber: 3,
      spanStartLine: null,
    });
  });

  it("sends an outdated comment with vanished content to the general area (id 107)", () => {
    expect(placementOf(107)).toEqual({ kind: "general", strategy: "outdated-unplaceable" });
  });

  it("routes a whole-file comment to a file note (id 108)", () => {
    expect(placementOf(108)).toEqual({ kind: "general", strategy: "file-note" });
  });
});

describe("synthetic fixture: threading", () => {
  it("threads a reply under its parent via inReplyToId (id 110 -> 101)", () => {
    const reply = byId.get("110");
    const parent = byId.get("101");

    expect(reply?.inReplyToId).toBe("101");
    expect(parent?.inReplyToId).toBeNull();
    // The reply itself still lands on a real line.
    expect(placementOf(110)).toEqual({
      kind: "line",
      strategy: "exact",
      side: "additions",
      lineNumber: 3,
      spanStartLine: null,
    });
  });
});

describe("synthetic fixture: phantom-newline filter", () => {
  it("keeps the real last line resolvable past the no-newline marker (id 109)", () => {
    // The beta.ts file ends without a trailing newline, so its diff carries
    // git's no-newline marker. The parser gives that marker the same line
    // number as the real last add, which would overwrite it in the lookups. The
    // filter drops the marker, so the real last line survives.
    expect(placementOf(109)).toEqual({
      kind: "line",
      strategy: "exact",
      side: "additions",
      lineNumber: 2,
      spanStartLine: null,
    });

    const lastLine = findRow(index, { path: "src/beta.ts", line: 2, side: "RIGHT" });
    expect(lastLine?.content).toBe("+const newLast = 11;");
  });
});
