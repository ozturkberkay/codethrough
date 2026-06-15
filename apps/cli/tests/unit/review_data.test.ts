// Tests for the review data and context builders: PR mode has the comments and a
// viewer/repo context; path mode has no comments and a null context.

import { describe, expect, it } from "vitest";

import { buildReviewContext, buildReviewData } from "../../src/run/review_data.js";
import { FIXTURE_COMMENT, FIXTURE_REVIEW } from "../fixtures/review_fixture.js";

const ingest = { meta: FIXTURE_REVIEW.meta, diffModel: FIXTURE_REVIEW.diff };

describe("buildReviewData", () => {
  it("assembles meta + diff + comments for PR mode", () => {
    const data = buildReviewData({
      ingest,
      comments: [FIXTURE_COMMENT],
      mode: "pr",
      sessionId: "s1",
      viewer: { login: "octocat" },
      repo: { owner: "octo", name: "demo" },
    });
    expect(data.meta).toBe(FIXTURE_REVIEW.meta);
    expect(data.diff).toBe(FIXTURE_REVIEW.diff);
    expect(data.comments).toEqual([FIXTURE_COMMENT]);
  });

  it("carries no comments in path mode", () => {
    const data = buildReviewData({
      ingest,
      comments: [],
      mode: "path",
      sessionId: "s1",
      viewer: null,
      repo: null,
    });
    expect(data.comments).toEqual([]);
  });
});

describe("buildReviewContext", () => {
  it("builds a PR-mode context with viewer + repo", () => {
    const context = buildReviewContext({
      ingest,
      comments: [],
      mode: "pr",
      sessionId: "s1",
      viewer: { login: "octocat" },
      repo: { owner: "octo", name: "demo" },
    });
    expect(context).toEqual({
      sessionId: "s1",
      mode: "pr",
      viewer: { login: "octocat" },
      repo: { owner: "octo", name: "demo" },
    });
  });

  it("builds a path-mode context with null viewer + repo", () => {
    const context = buildReviewContext({
      ingest,
      comments: [],
      mode: "path",
      sessionId: "s2",
      viewer: null,
      repo: null,
    });
    expect(context).toEqual({ sessionId: "s2", mode: "path", viewer: null, repo: null });
  });
});
