// Fetch a pull request's review comments, and optionally place them.
//
// GitHub returns at most 100 comments per page. Fetch every page first, then
// combine them. Combining during fetch silently drops earlier pages. The octokit
// client is passed in so a fake can prove no page is lost.

import type { Comment } from "@codethrough/schema";

import { buildCommentDiffIndex } from "./comment_diff_index.js";
import { placeAll } from "./comment_placement.js";
import type { GhReviewComment } from "./gh_review_comment.js";

// GitHub's max page size for list endpoints.
const MAX_PER_PAGE = 100;

// A pull request's coordinates, bundled so the helpers take fewer arguments.
interface PrRef {
  owner: string;
  repo: string;
  prNumber: number;
}

// Request params for listing review comments. The index signature lets the real
// octokit client match this shape (checked by a type test).
interface ListReviewCommentsParams {
  owner: string;
  repo: string;
  pull_number: number;
  per_page: number;
  [key: string]: unknown;
}

// The method paginate calls per page. Its return is opaque here; paginate reads
// the `.data` off each response.
type ListReviewCommentsMethod = (params: ListReviewCommentsParams) => Promise<unknown>;

// The small slice of octokit we use. Typing by shape keeps the fake tiny while
// still matching the real client (checked by a type test). paginate walks every
// page and returns one flat array.
interface PaginatingOctokit {
  paginate: <T>(method: ListReviewCommentsMethod, params: ListReviewCommentsParams) => Promise<T[]>;
  rest: {
    pulls: {
      listReviewComments: ListReviewCommentsMethod;
    };
  };
}

// Fetch every review comment on a PR across all pages.
const fetchReviewComments = (octokit: PaginatingOctokit, pr: PrRef): Promise<GhReviewComment[]> =>
  octokit.paginate<GhReviewComment>(octokit.rest.pulls.listReviewComments, {
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.prNumber,
    per_page: MAX_PER_PAGE,
  });

// Fetch the comments, index the diff, and place each one. The entry point ingest
// calls.
const loadPlacedComments = async (
  octokit: PaginatingOctokit,
  pr: PrRef,
  rawDiff: string,
): Promise<Comment[]> => {
  const comments = await fetchReviewComments(octokit, pr);
  const index = buildCommentDiffIndex(rawDiff);
  return placeAll(index, comments);
};

export { fetchReviewComments, loadPlacedComments };
export type { PaginatingOctokit, PrRef };
