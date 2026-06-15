// Tests for placeComment: the field mapping and the live-line cases (exact,
// anchored to additions or deletions, and the multi-line span). The general and
// reverse cases live in comment_placement_inverse.test.ts.

import { parse } from "valibot";
import { Comment } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { buildCommentDiffIndex } from "../../src/comment_diff_index.js";
import { placeComment } from "../../src/comment_placement.js";
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

describe("placeComment: field mapping", () => {
  it("maps every gh field onto the schema Comment", () => {
    const gh = ghComment({
      id: 42,
      line: 2,
      side: "RIGHT",
      original_line: 7,
      start_line: null,
      in_reply_to_id: 99,
      body: "Looks good.",
      user: { login: "alice" },
    });
    const c = placeComment(index, gh);

    expect(c.id).toBe("42");
    expect(c.path).toBe("a.ts");
    expect(c.body).toBe("Looks good.");
    expect(c.author).toBe("alice");
    expect(c.line).toBe(2);
    expect(c.originalLine).toBe(7);
    expect(c.side).toBe("RIGHT");
    expect(c.startLine).toBeNull();
    expect(c.subjectType).toBe("line");
    expect(c.inReplyToId).toBe("99");
    // The result passes schema validation.
    expect(() => parse(Comment, c)).not.toThrow();
  });

  it("defaults body to '' and author to '' when absent", () => {
    const c = placeComment(index, ghComment({ line: 2, side: "RIGHT", user: null }));

    expect(c.body).toBe("");
    expect(c.author).toBe("");
  });

  it("defaults a missing side to RIGHT", () => {
    const c = placeComment(index, ghComment({ line: 2, side: null }));

    expect(c.side).toBe("RIGHT");
  });

  it("keeps inReplyToId null for a top-level comment", () => {
    const c = placeComment(index, ghComment({ line: 2, side: "RIGHT", in_reply_to_id: null }));

    expect(c.inReplyToId).toBeNull();
  });
});

describe("placeComment: line strategies", () => {
  it("places an added line exactly on additions", () => {
    const c = placeComment(index, ghComment({ line: 2, side: "RIGHT" }));

    expect(c.placement).toEqual({
      kind: "line",
      strategy: "exact",
      side: "additions",
      lineNumber: 2,
      spanStartLine: null,
    });
  });

  it("places a deleted line exactly on deletions", () => {
    const c = placeComment(index, ghComment({ line: 2, side: "LEFT" }));

    expect(c.placement).toEqual({
      kind: "line",
      strategy: "exact",
      side: "deletions",
      lineNumber: 2,
      spanStartLine: null,
    });
  });

  it("anchors a RIGHT context comment to the additions row (anchored-additions)", () => {
    // The context line is new line 3, old line 3.
    const c = placeComment(index, ghComment({ line: 3, side: "RIGHT" }));

    expect(c.placement).toEqual({
      kind: "line",
      strategy: "anchored-additions",
      side: "additions",
      lineNumber: 3,
      spanStartLine: null,
    });
  });

  it("anchors a LEFT context comment to the deletions row (anchored-deletions)", () => {
    const c = placeComment(index, ghComment({ line: 3, side: "LEFT" }));

    expect(c.placement).toEqual({
      kind: "line",
      strategy: "anchored-deletions",
      side: "deletions",
      lineNumber: 3,
      spanStartLine: null,
    });
  });

  it("carries the span start for a multi-line comment (Pierre pins the end line)", () => {
    const c = placeComment(index, ghComment({ line: 3, side: "RIGHT", start_line: 1 }));

    expect(c.placement).toEqual({
      kind: "line",
      strategy: "anchored-additions",
      side: "additions",
      lineNumber: 3,
      spanStartLine: 1,
    });
  });

  it("leaves spanStartLine null when start_line equals line", () => {
    const c = placeComment(index, ghComment({ line: 2, side: "RIGHT", start_line: 2 }));

    expect(c.placement.kind === "line" && c.placement.spanStartLine).toBeNull();
  });
});
