// Tests for the write-side helpers: building a draft comment from a clicked line
// and applying a live update to a comment list.

import type { Comment, CommentDelta, CommentDraft } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { applyCommentDelta, buildFileDraft, buildLineDraft } from "../../src/comment_draft.js";

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

describe("buildLineDraft", () => {
  it("drafts a RIGHT-side line comment from an additions target", () => {
    const draft = buildLineDraft({
      path: "src/a.ts",
      side: "additions",
      lineNumber: 12,
      body: "Nit.",
    });
    const expected: CommentDraft = {
      path: "src/a.ts",
      body: "Nit.",
      line: 12,
      side: "RIGHT",
      startLine: null,
      startSide: null,
      subjectType: "line",
    };
    expect(draft).toEqual(expected);
  });

  it("drafts a LEFT-side line comment from a deletions target", () => {
    const draft = buildLineDraft({
      path: "src/a.ts",
      side: "deletions",
      lineNumber: 5,
      body: "Gone?",
    });
    expect(draft.side).toBe("LEFT");
    expect(draft.line).toBe(5);
    expect(draft.subjectType).toBe("line");
  });
});

describe("buildFileDraft", () => {
  it("drafts a file-level comment with no line or side", () => {
    const draft = buildFileDraft("src/a.ts", "Whole-file note.");
    const expected: CommentDraft = {
      path: "src/a.ts",
      body: "Whole-file note.",
      line: null,
      side: null,
      startLine: null,
      startSide: null,
      subjectType: "file",
    };
    expect(draft).toEqual(expected);
  });
});

describe("applyCommentDelta", () => {
  const base = [comment({ id: "c1" }), comment({ id: "c2", body: "second" })];

  it("appends added comments in delta order", () => {
    const delta: CommentDelta = {
      added: [comment({ id: "c3", body: "new" })],
      updated: [],
      removed: [],
    };
    expect(applyCommentDelta(base, delta).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("replaces an updated comment in place", () => {
    const delta: CommentDelta = {
      added: [],
      updated: [comment({ id: "c2", body: "edited" })],
      removed: [],
    };
    const merged = applyCommentDelta(base, delta);
    expect(merged.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(merged.find((c) => c.id === "c2")?.body).toBe("edited");
  });

  it("drops a removed comment", () => {
    const delta: CommentDelta = { added: [], updated: [], removed: [comment({ id: "c1" })] };
    expect(applyCommentDelta(base, delta).map((c) => c.id)).toEqual(["c2"]);
  });

  it("combines add, update, and remove in one delta", () => {
    const delta: CommentDelta = {
      added: [comment({ id: "c9" })],
      updated: [comment({ id: "c2", body: "x" })],
      removed: [comment({ id: "c1" })],
    };
    const merged = applyCommentDelta(base, delta);
    expect(merged.map((c) => c.id)).toEqual(["c2", "c9"]);
    expect(merged[0]?.body).toBe("x");
  });

  it("does not duplicate an added id already present", () => {
    const delta: CommentDelta = {
      added: [comment({ id: "c1", body: "dupe" })],
      updated: [],
      removed: [],
    };
    // Id c1 already exists, so it is not appended again.
    expect(applyCommentDelta(base, delta).map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("returns an equivalent list for an empty delta", () => {
    expect(
      applyCommentDelta(base, { added: [], updated: [], removed: [] }).map((c) => c.id),
    ).toEqual(["c1", "c2"]);
  });
});
