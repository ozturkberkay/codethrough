// Build the review data and context the server holds, from an ingest. PR mode has
// the GitHub meta, comments, and a viewer/repo context; path mode has the minimal
// meta, no comments, and a null viewer/repo. Kept separate from I/O so it is tested.

import type {
  Comment,
  DiffModel,
  ReviewContext,
  ReviewData,
  ReviewMeta,
} from "@codethrough/schema";

// The part of an ingest this needs (the meta and diff). A subset of both ingest
// result types, so either fits without an adapter.
interface IngestSlice {
  meta: ReviewMeta;
  diffModel: DiffModel;
}

// Inputs to build the review data. In path mode `comments` is empty and `viewer`
// and `repo` are null.
interface ReviewDataInputs {
  ingest: IngestSlice;
  comments: Comment[];
  mode: "pr" | "path";
  sessionId: string;
  viewer: { login: string } | null;
  repo: { owner: string; name: string } | null;
}

// Assemble the review data (meta, diff, comments).
const buildReviewData = (inputs: ReviewDataInputs): ReviewData => ({
  meta: inputs.ingest.meta,
  diff: inputs.ingest.diffModel,
  comments: inputs.comments,
});

// Assemble the session context the frontend reads.
const buildReviewContext = (inputs: ReviewDataInputs): ReviewContext => ({
  sessionId: inputs.sessionId,
  mode: inputs.mode,
  viewer: inputs.viewer,
  repo: inputs.repo,
});

export { buildReviewContext, buildReviewData };
export type { IngestSlice, ReviewDataInputs };
