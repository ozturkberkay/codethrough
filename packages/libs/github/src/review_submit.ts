// Submit one pull-request review via octokit (the reverse of fetching comments).
//
// GitHub's comment fields are snake_case while our drafts are camelCase, so we
// rename them. A null field is left out, because GitHub rejects a null where it
// wants the field absent.
//
// The octokit client is passed in so the mapping and the call can be tested with
// a tiny fake and no network.

import type { CommentDraft, ReviewEvent } from "@codethrough/schema";

import type { PrRef } from "./pr_url.js";

// One comment in GitHub's comments array. line, side, start_line, and start_side
// are optional: a single-line comment may have only path, body, and line, and a
// file-level one has no line or side at all.
interface GhCommentEntry {
  path: string;
  body: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
}

// The createReview params. The index signature lets the real octokit client
// match this shape (checked by a type test).
interface CreateReviewParams {
  owner: string;
  repo: string;
  pull_number: number;
  event: ReviewEvent;
  body?: string;
  comments?: GhCommentEntry[];
  [key: string]: unknown;
}

// The fields from the createReview response we return: the new review's id and
// its url. The real response has more.
interface CreateReviewData {
  id: number;
  html_url: string;
}

// The small slice of octokit we use: a createReview whose response has the review
// JSON on `.data`. The real client matches this (checked by a type test).
interface ReviewPullsClient {
  rest: {
    pulls: {
      createReview: (params: CreateReviewParams) => Promise<{ data: CreateReviewData }>;
    };
  };
}

// What a caller submits: the review action, an optional summary, and the draft
// comments to attach.
interface SubmitReviewPayload {
  event: ReviewEvent;
  body?: string;
  comments?: CommentDraft[];
}

// What submitReview returns: the new review's id and its url.
interface SubmitReviewResult {
  id: number;
  htmlUrl: string;
}

// Add a field only when its value is not null, so a null is left out entirely.
// GitHub rejects a null where it wants the field absent. Generic over the field
// name and type so each call stays one short spread.
const optionalEntry = <K extends string, V>(key: K, value: V | null): Partial<Record<K, V>> =>
  value === null ? {} : ({ [key]: value } as Record<K, V>);

// Map one draft to a GitHub comment. path and body are always there; the rest are
// added only when not null, renaming camelCase to snake_case.
const toCommentEntry = (draft: CommentDraft): GhCommentEntry => ({
  path: draft.path,
  body: draft.body,
  ...optionalEntry("line", draft.line),
  ...optionalEntry("side", draft.side),
  ...optionalEntry("start_line", draft.startLine),
  ...optionalEntry("start_side", draft.startSide),
});

// Build the createReview params from the ref and payload. comments is included
// only when there is at least one draft (a bare approval leaves it out).
const toCreateReviewParams = (ref: PrRef, payload: SubmitReviewPayload): CreateReviewParams => {
  const params: CreateReviewParams = {
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.number,
    event: payload.event,
  };
  if (payload.body !== undefined) {
    params.body = payload.body;
  }
  if (payload.comments !== undefined && payload.comments.length > 0) {
    params.comments = payload.comments.map(toCommentEntry);
  }
  return params;
};

// Submit the review: map the payload, call createReview, and return the new
// review's id and url.
const submitReview = async (
  octokit: ReviewPullsClient,
  ref: PrRef,
  payload: SubmitReviewPayload,
): Promise<SubmitReviewResult> => {
  const { data } = await octokit.rest.pulls.createReview(toCreateReviewParams(ref, payload));
  return { id: data.id, htmlUrl: data.html_url };
};

export { submitReview, toCommentEntry, toCreateReviewParams };
export type { ReviewPullsClient, SubmitReviewPayload, SubmitReviewResult };
