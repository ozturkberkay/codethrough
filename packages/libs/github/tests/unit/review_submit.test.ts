// Tests for submitReview: the draft-to-GitHub-comment mapping (camelCase to
// snake_case, null fields left out), the createReview params (a bare approve, and
// a comment with a single-line and a multi-line draft), and the returned id and
// url. The octokit is a tiny fake that records its params, so no network.

import type { CommentDraft } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { type ReviewPullsClient, submitReview, toCommentEntry } from "../../src/review_submit.js";

const REF = { owner: "octo", repo: "demo", number: 42 };

// The default review the fake returns. Kept out of the parameter default to
// satisfy a lint rule.
const DEFAULT_REVIEW = {
  id: 555,
  html_url: "https://github.com/octo/demo/pull/42#pullrequestreview-555",
};

// A fake createReview client. Records each call's params into `calls` and returns
// the given review (default DEFAULT_REVIEW), like the real octokit.
const fakeClient = (
  calls: Record<string, unknown>[],
  data: { id: number; html_url: string } = DEFAULT_REVIEW,
): ReviewPullsClient => ({
  rest: {
    pulls: {
      createReview: async (params) => {
        calls.push(params);
        return { data };
      },
    },
  },
});

// A single-line RIGHT-side draft, with a line and no span.
const lineDraft: CommentDraft = {
  path: "src/a.ts",
  body: "Nit: rename this.",
  line: 12,
  side: "RIGHT",
  startLine: null,
  startSide: null,
  subjectType: "line",
};

// A multi-line LEFT-side draft, with a span via startLine and startSide.
const multiLineDraft: CommentDraft = {
  path: "src/b.ts",
  body: "This whole block is unused.",
  line: 20,
  side: "LEFT",
  startLine: 15,
  startSide: "LEFT",
  subjectType: "line",
};

describe("toCommentEntry", () => {
  it("maps a single-line draft to a snake_case entry, omitting null span fields", () => {
    expect(toCommentEntry(lineDraft)).toEqual({
      path: "src/a.ts",
      body: "Nit: rename this.",
      line: 12,
      side: "RIGHT",
    });
  });

  it("maps a multi-line draft, carrying start_line + start_side", () => {
    expect(toCommentEntry(multiLineDraft)).toEqual({
      path: "src/b.ts",
      body: "This whole block is unused.",
      line: 20,
      side: "LEFT",
      start_line: 15,
      start_side: "LEFT",
    });
  });

  it("omits line and side entirely when both are null (a file-level draft)", () => {
    const fileDraft: CommentDraft = {
      path: "src/c.ts",
      body: "Whole-file note.",
      line: null,
      side: null,
      startLine: null,
      startSide: null,
      subjectType: "file",
    };
    expect(toCommentEntry(fileDraft)).toEqual({ path: "src/c.ts", body: "Whole-file note." });
  });
});

describe("submitReview", () => {
  it("calls createReview for an APPROVE with no body and no comments key", async () => {
    const calls: Record<string, unknown>[] = [];
    const result = await submitReview(fakeClient(calls), REF, { event: "APPROVE" });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ owner: "octo", repo: "demo", pull_number: 42, event: "APPROVE" });
    // A bare approval sends no body and no comments.
    expect(calls[0]).not.toHaveProperty("body");
    expect(calls[0]).not.toHaveProperty("comments");
    expect(result).toEqual({
      id: 555,
      htmlUrl: "https://github.com/octo/demo/pull/42#pullrequestreview-555",
    });
  });

  it("sends a COMMENT with a body and a single-line + multi-line comments array", async () => {
    const calls: Record<string, unknown>[] = [];
    await submitReview(fakeClient(calls), REF, {
      event: "COMMENT",
      body: "A few notes.",
      comments: [lineDraft, multiLineDraft],
    });

    expect(calls[0]).toEqual({
      owner: "octo",
      repo: "demo",
      pull_number: 42,
      event: "COMMENT",
      body: "A few notes.",
      comments: [
        { path: "src/a.ts", body: "Nit: rename this.", line: 12, side: "RIGHT" },
        {
          path: "src/b.ts",
          body: "This whole block is unused.",
          line: 20,
          side: "LEFT",
          start_line: 15,
          start_side: "LEFT",
        },
      ],
    });
  });

  it("omits an empty comments array (an approval with body but no drafts)", async () => {
    const calls: Record<string, unknown>[] = [];
    await submitReview(fakeClient(calls), REF, {
      event: "REQUEST_CHANGES",
      body: "Please address the above.",
      comments: [],
    });

    expect(calls[0]).toEqual({
      owner: "octo",
      repo: "demo",
      pull_number: 42,
      event: "REQUEST_CHANGES",
      body: "Please address the above.",
    });
    expect(calls[0]).not.toHaveProperty("comments");
  });

  it("surfaces the created review id and html url", async () => {
    const result = await submitReview(
      fakeClient([], { id: 999, html_url: "https://example.com/r/999" }),
      REF,
      { event: "COMMENT", body: "x" },
    );
    expect(result).toEqual({ id: 999, htmlUrl: "https://example.com/r/999" });
  });
});
