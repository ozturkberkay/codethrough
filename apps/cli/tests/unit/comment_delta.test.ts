// Tests for the comment diff: the added, updated, and removed buckets between two
// comment lists, matched by id, plus the empty check.

import type { Comment } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { diffCommentLists, isEmptyDelta } from "../../src/server/comment_delta.js";

// Build a line comment from a few overrides.
const comment = (over: Partial<Comment> & { id: string }): Comment => ({
  path: "src/a.ts",
  body: "a comment",
  author: "octocat",
  line: 1,
  originalLine: 1,
  side: "RIGHT",
  startLine: null,
  subjectType: "line",
  inReplyToId: null,
  placement: {
    kind: "line",
    strategy: "exact",
    side: "additions",
    lineNumber: 1,
    spanStartLine: null,
  },
  ...over,
});

describe("diffCommentLists", () => {
  it("reports an added comment present only in next", () => {
    const prev = [comment({ id: "c1" })];
    const next = [comment({ id: "c1" }), comment({ id: "c2", body: "new" })];

    const delta = diffCommentLists(prev, next);
    expect(delta.added.map((c) => c.id)).toEqual(["c2"]);
    expect(delta.updated).toEqual([]);
    expect(delta.removed).toEqual([]);
  });

  it("reports a removed comment present only in prev", () => {
    const prev = [comment({ id: "c1" }), comment({ id: "c2" })];
    const next = [comment({ id: "c1" })];

    const delta = diffCommentLists(prev, next);
    expect(delta.removed.map((c) => c.id)).toEqual(["c2"]);
    expect(delta.added).toEqual([]);
    expect(delta.updated).toEqual([]);
  });

  it("reports an updated comment whose body changed", () => {
    const prev = [comment({ id: "c1", body: "before" })];
    const next = [comment({ id: "c1", body: "after" })];

    const delta = diffCommentLists(prev, next);
    expect(delta.updated.map((c) => c.body)).toEqual(["after"]);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
  });

  it("reports an updated comment whose placement (not body) changed", () => {
    const prev = [comment({ id: "c1" })];
    const next = [
      comment({
        id: "c1",
        placement: {
          kind: "line",
          strategy: "outdated-historical",
          side: "additions",
          lineNumber: 9,
          spanStartLine: null,
        },
      }),
    ];

    const delta = diffCommentLists(prev, next);
    expect(delta.updated.map((c) => c.id)).toEqual(["c1"]);
  });

  it("emits nothing for two equal snapshots", () => {
    const snapshot = [comment({ id: "c1" }), comment({ id: "c2" })];
    const delta = diffCommentLists(snapshot, [comment({ id: "c1" }), comment({ id: "c2" })]);
    expect(delta).toEqual({ added: [], updated: [], removed: [] });
  });

  it("combines added, updated, and removed in one diff", () => {
    const prev = [
      comment({ id: "keep" }),
      comment({ id: "edit", body: "old" }),
      comment({ id: "gone" }),
    ];
    const next = [
      comment({ id: "keep" }),
      comment({ id: "edit", body: "new" }),
      comment({ id: "fresh" }),
    ];

    const delta = diffCommentLists(prev, next);
    expect(delta.added.map((c) => c.id)).toEqual(["fresh"]);
    expect(delta.updated.map((c) => c.id)).toEqual(["edit"]);
    expect(delta.removed.map((c) => c.id)).toEqual(["gone"]);
  });

  it("preserves next order for added/updated and prev order for removed", () => {
    const prev = [comment({ id: "a" }), comment({ id: "b" }), comment({ id: "c" })];
    const next = [comment({ id: "z", body: "n" }), comment({ id: "y", body: "n" })];

    const delta = diffCommentLists(prev, next);
    // The removed ids keep the old order; the added ids keep the new order.
    expect(delta.removed.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(delta.added.map((c) => c.id)).toEqual(["z", "y"]);
  });
});

describe("isEmptyDelta", () => {
  it("is true only when all three buckets are empty", () => {
    expect(isEmptyDelta({ added: [], updated: [], removed: [] })).toBe(true);
    expect(isEmptyDelta({ added: [comment({ id: "c1" })], updated: [], removed: [] })).toBe(false);
    expect(isEmptyDelta({ added: [], updated: [comment({ id: "c1" })], removed: [] })).toBe(false);
    expect(isEmptyDelta({ added: [], updated: [], removed: [comment({ id: "c1" })] })).toBe(false);
  });
});
