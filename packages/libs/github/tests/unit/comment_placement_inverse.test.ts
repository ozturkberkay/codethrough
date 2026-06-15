// Tests for the general (non-line) cases (file note, outdated re-anchor, and
// unplaceable), placeAll, and rowToDraftTarget (single and multi-line drag). The
// live-line cases and field mapping live in comment_placement.test.ts.

import { parse } from "valibot";
import { CommentDraft } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { buildCommentDiffIndex } from "../../src/comment_diff_index.js";
import { placeAll, placeComment, rowToDraftTarget } from "../../src/comment_placement.js";
import type { GhReviewComment } from "../../src/gh_review_comment.js";

// A diff with an add (new line 2), a delete (old line 2), and a context line
// reachable from both sides (old line 3, new line 3).
const diff = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const old = 2;
+const added = 2;
 const ctx = 3;
`;

const index = buildCommentDiffIndex(diff);

// A saved hunk whose last line still exists in the current diff, so an outdated
// comment re-anchors to it.
const matchingHunk = "@@ -1,3 +1,3 @@\n const a = 1;\n const ctx = 3;";
// A saved hunk whose last line is gone from the current diff.
const staleHunk = "@@ -9,1 +9,1 @@\n const vanished = 9;";

// Build a comment from a few overrides.
const ghComment = (over: Partial<GhReviewComment>): GhReviewComment => ({
  id: 1,
  path: "a.ts",
  line: null,
  side: null,
  start_line: null,
  start_side: null,
  original_line: null,
  in_reply_to_id: null,
  subject_type: "line",
  diff_hunk: "",
  user: { login: "octocat" },
  ...over,
});

describe("placeComment: general (non-line) strategies", () => {
  it("routes a file-level comment to a file-note general placement", () => {
    const c = placeComment(index, ghComment({ subject_type: "file", line: null }));

    expect(c.placement).toEqual({ kind: "general", strategy: "file-note" });
  });

  it("re-anchors an outdated comment whose diff_hunk last line still exists", () => {
    // No line (outdated). The hunk's last line matches the context row, so it
    // re-anchors there on the additions side.
    const c = placeComment(
      index,
      ghComment({ line: null, side: "RIGHT", diff_hunk: matchingHunk }),
    );

    expect(c.placement).toEqual({
      kind: "line",
      strategy: "outdated-historical",
      side: "additions",
      lineNumber: 3,
      spanStartLine: null,
    });
  });

  it("re-anchors an outdated LEFT comment onto the deletions side", () => {
    const c = placeComment(index, ghComment({ line: null, side: "LEFT", diff_hunk: matchingHunk }));

    expect(c.placement).toEqual({
      kind: "line",
      strategy: "outdated-historical",
      side: "deletions",
      lineNumber: 3,
      spanStartLine: null,
    });
  });

  it("re-anchors an outdated comment with a null side onto the additions default", () => {
    // A missing side defaults to RIGHT, so it lands on additions.
    const c = placeComment(index, ghComment({ line: null, side: null, diff_hunk: matchingHunk }));

    expect(c.placement).toEqual({
      kind: "line",
      strategy: "outdated-historical",
      side: "additions",
      lineNumber: 3,
      spanStartLine: null,
    });
  });

  it("marks an outdated comment unplaceable when no current row matches", () => {
    const c = placeComment(index, ghComment({ line: null, side: "RIGHT", diff_hunk: staleHunk }));

    expect(c.placement).toEqual({ kind: "general", strategy: "outdated-unplaceable" });
  });

  it("marks an outdated comment unplaceable when its diff_hunk is empty", () => {
    const c = placeComment(index, ghComment({ line: null, side: "RIGHT", diff_hunk: "" }));

    expect(c.placement).toEqual({ kind: "general", strategy: "outdated-unplaceable" });
  });

  it("treats a line absent from the current diff as historical (re-anchors)", () => {
    // The line is set but not in the diff; a matching hunk re-anchors it, so the
    // not-found case goes through the outdated path.
    const c = placeComment(index, ghComment({ line: 800, side: "RIGHT", diff_hunk: matchingHunk }));

    expect(c.placement.kind === "line" && c.placement.strategy).toBe("outdated-historical");
  });

  it("treats an unmatched absent line as unplaceable", () => {
    const c = placeComment(index, ghComment({ line: 800, side: "RIGHT", diff_hunk: staleHunk }));

    expect(c.placement).toEqual({ kind: "general", strategy: "outdated-unplaceable" });
  });

  it("marks an outdated comment unplaceable when the file is absent from the diff", () => {
    const c = placeComment(
      index,
      ghComment({ path: "other.ts", line: null, side: "RIGHT", diff_hunk: matchingHunk }),
    );

    expect(c.placement).toEqual({ kind: "general", strategy: "outdated-unplaceable" });
  });
});

describe("placeAll", () => {
  it("places every comment, preserving input order", () => {
    const placed = placeAll(index, [
      ghComment({ id: 1, line: 2, side: "RIGHT" }),
      ghComment({ id: 2, subject_type: "file", line: null }),
    ]);

    expect(placed.map((c) => c.id)).toEqual(["1", "2"]);
    expect(placed[0]?.placement.kind).toBe("line");
    expect(placed[1]?.placement.kind).toBe("general");
  });
});

describe("rowToDraftTarget: inverse mapping", () => {
  it("drafts a RIGHT-side target from an additions annotation", () => {
    const draft = rowToDraftTarget("a.ts", { side: "additions", lineNumber: 2 });

    expect(draft).toEqual({
      path: "a.ts",
      body: "",
      line: 2,
      side: "RIGHT",
      startLine: null,
      startSide: null,
      subjectType: "line",
    });
    expect(() => parse(CommentDraft, draft)).not.toThrow();
  });

  it("drafts a LEFT-side target from a deletions annotation", () => {
    const draft = rowToDraftTarget("a.ts", { side: "deletions", lineNumber: 2 });

    expect(draft.side).toBe("LEFT");
    expect(draft.line).toBe(2);
  });

  it("produces startLine/startSide for a multi-line drag (end line pinned)", () => {
    const draft = rowToDraftTarget(
      "a.ts",
      { side: "additions", lineNumber: 5 },
      { side: "additions", lineNumber: 2 },
    );

    expect(draft).toEqual({
      path: "a.ts",
      body: "",
      line: 5,
      side: "RIGHT",
      startLine: 2,
      startSide: "RIGHT",
      subjectType: "line",
    });
  });

  it("orders the span regardless of drag direction", () => {
    const draft = rowToDraftTarget(
      "a.ts",
      { side: "additions", lineNumber: 2 },
      { side: "additions", lineNumber: 5 },
    );

    expect(draft.line).toBe(5);
    expect(draft.startLine).toBe(2);
  });

  it("ignores a start annotation on a different side (single-line)", () => {
    const draft = rowToDraftTarget(
      "a.ts",
      { side: "additions", lineNumber: 5 },
      { side: "deletions", lineNumber: 2 },
    );

    expect(draft.startLine).toBeNull();
    expect(draft.startSide).toBeNull();
    expect(draft.line).toBe(5);
  });

  it("ignores a start annotation equal to the end (single-line)", () => {
    const draft = rowToDraftTarget(
      "a.ts",
      { side: "additions", lineNumber: 5 },
      { side: "additions", lineNumber: 5 },
    );

    expect(draft.startLine).toBeNull();
  });
});
