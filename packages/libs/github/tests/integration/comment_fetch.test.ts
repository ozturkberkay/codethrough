// Fetch and place comments through a fake octokit whose paginate returns several
// pages, proving we keep every page. The fake walks all pages and returns one
// flat array, like the real one, so dropping pages would fail here.

import { describe, expect, it, vi } from "vitest";

import {
  fetchReviewComments,
  loadPlacedComments,
  type PaginatingOctokit,
  type PrRef,
} from "../../src/comment_fetch.js";
import type { GhReviewComment } from "../../src/gh_review_comment.js";

const MAX_PER_PAGE = 100;

const PR: PrRef = { owner: "octo", repo: "repo", prNumber: 7 };

// Build a comment with a given id. The defaults make it land on an added line.
const ghComment = (id: number, over: Partial<GhReviewComment> = {}): GhReviewComment => ({
  id,
  path: "a.ts",
  line: 2,
  side: "RIGHT",
  start_line: null,
  start_side: null,
  original_line: 2,
  in_reply_to_id: null,
  subject_type: "line",
  diff_hunk: "@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;",
  user: { login: "octocat" },
  ...over,
});

// A diff that adds new line 2, so the default comments land exactly.
const diff = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;

interface FakeResult {
  octokit: PaginatingOctokit;
  calls: ListReviewCommentsParams[];
}

interface ListReviewCommentsParams {
  owner: string;
  repo: string;
  pull_number: number;
  per_page: number;
}

// A fake octokit whose paginate joins the given pages into one array, like the
// real one. It records its call params so we can check per_page and the PR.
const fakeOctokit = (pages: GhReviewComment[][]): FakeResult => {
  const calls: ListReviewCommentsParams[] = [];
  const listReviewComments = vi.fn(async (): Promise<unknown> => ({ data: [] }));
  const paginate = vi.fn(async (_method: unknown, params: ListReviewCommentsParams) => {
    // The real one fetches each page; the fake just flattens. Either way: all
    // pages, one array, nothing dropped.
    calls.push(params);
    return pages.flat();
  });
  const octokit = {
    rest: { pulls: { listReviewComments } },
    paginate,
  } as unknown as PaginatingOctokit;
  return { octokit, calls };
};

describe("fetchReviewComments", () => {
  it("aggregates every page into one array (no page dropped)", async () => {
    const page1 = Array.from({ length: MAX_PER_PAGE }, (_, i) => ghComment(i + 1));
    const page2 = Array.from({ length: MAX_PER_PAGE }, (_, i) => ghComment(MAX_PER_PAGE + i + 1));
    const page3 = [ghComment(201), ghComment(202)];
    const { octokit } = fakeOctokit([page1, page2, page3]);

    const result = await fetchReviewComments(octokit, PR);

    // All three pages survive; keeping only the last would give just 2.
    expect(result).toHaveLength(MAX_PER_PAGE * 2 + 2);
    expect(result.at(0)?.id).toBe(1);
    expect(result.at(-1)?.id).toBe(202);
  });

  it("requests 100 per page with the PR coordinates", async () => {
    const { octokit, calls } = fakeOctokit([[ghComment(1)]]);

    await fetchReviewComments(octokit, PR);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      owner: "octo",
      repo: "repo",
      pull_number: 7,
      per_page: MAX_PER_PAGE,
    });
  });

  it("returns an empty array for a PR with no comments", async () => {
    const { octokit } = fakeOctokit([[]]);

    expect(await fetchReviewComments(octokit, PR)).toEqual([]);
  });
});

describe("loadPlacedComments", () => {
  it("fetches across pages, indexes the diff, and places each comment", async () => {
    const page1 = [ghComment(1)];
    const page2 = [ghComment(2, { subject_type: "file", line: null })];
    const { octokit } = fakeOctokit([page1, page2]);

    const placed = await loadPlacedComments(octokit, PR, diff);

    expect(placed.map((c) => c.id)).toEqual(["1", "2"]);
    // The line comment landed exactly; the file comment went to the general area.
    expect(placed[0]?.placement).toEqual({
      kind: "line",
      strategy: "exact",
      side: "additions",
      lineNumber: 2,
      spanStartLine: null,
    });
    expect(placed[1]?.placement).toEqual({ kind: "general", strategy: "file-note" });
  });

  it("aggregates a large multi-page fetch before placing", async () => {
    const pages = [
      Array.from({ length: MAX_PER_PAGE }, (_, i) => ghComment(i + 1)),
      [ghComment(MAX_PER_PAGE + 1)],
    ];
    const { octokit } = fakeOctokit(pages);

    const placed = await loadPlacedComments(octokit, PR, diff);

    expect(placed).toHaveLength(MAX_PER_PAGE + 1);
    expect(placed.every((c) => c.placement.kind === "line")).toBe(true);
  });
});
