// The review data the server's routes read from. It holds the review (meta, diff,
// comments), runs the walkthrough, stores draft comments and submits them, and
// drives live comment polling. The HTTP routes are how this reaches the frontend.
//
// Every I/O helper is injected (the walkthrough runner, the GitHub submit, the
// comment re-fetch) so this stays plain logic and easy to test. Job handling
// (start, stream, cancel) and the draft lifecycle (draft, submit, clear) live here.
//
// CAPABILITIES: in PR mode the submit and re-fetch helpers exist, so comments are
// on. In local-path mode there is no GitHub, so they are absent and comments are
// off (writing and live polling are unavailable).
//
// It pulls in many schema types and defines two error classes, so two count limits
// are off.
/* oxlint-disable import/max-dependencies */
/* oxlint-disable max-classes-per-file */

import type {
  Comment,
  CommentDelta,
  CommentDraft,
  ReviewContext,
  ReviewData,
  ReviewEvent,
  WalkthroughChunk,
} from "@codethrough/schema";

import { pollCommentDeltas, type Wait } from "./comment_poller.js";
import { createDraftStore, type DraftStore } from "./draft_store.js";

// Produces the walkthrough stream for one run. Cancelling aborts the signal so a
// long run can stop early.
type WalkthroughRunner = (signal: AbortSignal) => AsyncIterable<WalkthroughChunk>;

// The injected GitHub submit. Returns the new review's url. Absent in path mode.
type SubmitFn = (payload: {
  event: ReviewEvent;
  body?: string;
  comments?: CommentDraft[];
}) => Promise<{ htmlUrl: string }>;

// The injected comment re-fetch the poller calls. Absent in path mode.
type FetchCommentsFn = () => Promise<Comment[]>;

// One running (or finished) job and its abort control. We start the runner only
// when a client connects, so a client that never does kicks off nothing.
interface Job {
  controller: AbortController;
}

// What the source needs: the review data, the session context, the walkthrough
// runner, the poll timing, and (PR mode only) the submit and re-fetch helpers.
// Those two optional helpers decide whether comments are available.
interface ReviewSourceDeps {
  data: ReviewData;
  context: ReviewContext;
  runWalkthrough: WalkthroughRunner;
  // The poll wait and interval; injected so the stream is testable.
  wait: Wait;
  intervalMs: number;
  // PR mode only: submit a review and re-fetch comments. Both absent means path
  // mode (no writing, no live polling).
  submit?: SubmitFn;
  fetchComments?: FetchCommentsFn;
}

// Everything the routes call. Its own interface so the routes depend on the shape,
// not the factory.
interface ServerReviewSource {
  context: ReviewContext;
  getReview: () => ReviewData;
  listComments: () => Comment[];
  startWalkthrough: () => { jobId: string };
  // The request signal fires when the client disconnects; it is combined with the
  // job's own cancel so either one stops the run.
  streamWalkthrough: (
    jobId: string,
    requestSignal?: AbortSignal,
  ) => AsyncIterable<WalkthroughChunk>;
  cancelWalkthrough: (jobId: string) => void;
  // Writes: draft and store a comment, list the drafts, or submit them all as one
  // review (which clears them and returns the url).
  draftComment: (body: unknown) => CommentDraft | null;
  listDrafts: () => CommentDraft[];
  submitReview: (payload: { event: ReviewEvent; body?: string }) => Promise<{ htmlUrl: string }>;
  // The live comment changes the stream route sends. Stops on the signal.
  streamCommentDeltas: (signal: AbortSignal) => AsyncIterable<CommentDelta>;
  capabilities: { comments: boolean };
}

// Thrown when a jobId does not match a started job (a stale or wrong id).
class UnknownJobError extends Error {}

// Thrown when a write or live action is tried in a run without GitHub. The route
// turns it into a 409 so the UI disables those controls.
class CommentsUnavailableError extends Error {}

// An empty stream, returned for a cancelled job so a late connect ends right away
// instead of hanging.
const emptyStream = async function* emptyStreamGen(): AsyncIterable<WalkthroughChunk> {
  // Yields nothing on purpose.
};

// The job side (start, stream, cancel). Split out so createReviewSource stays thin.
interface JobManager {
  startWalkthrough: () => { jobId: string };
  streamWalkthrough: (
    jobId: string,
    requestSignal?: AbortSignal,
  ) => AsyncIterable<WalkthroughChunk>;
  cancelWalkthrough: (jobId: string) => void;
}

// Combine the job's cancel signal with the request's disconnect signal so either
// one stops the run. With no request signal it is just the job's signal.
const combineSignals = (job: AbortSignal, request: AbortSignal | undefined): AbortSignal =>
  request ? AbortSignal.any([job, request]) : job;

// Build the job side over the injected runner. Streaming a cancelled job yields
// nothing; an unknown id throws. The run stops on either a cancel or a disconnect.
const createJobManager = (run: WalkthroughRunner): JobManager => {
  const jobs = new Map<string, Job>();
  const get = (jobId: string): Job => {
    const job = jobs.get(jobId);
    if (job === undefined) {
      throw new UnknownJobError(`No walkthrough job for id ${jobId}.`);
    }
    return job;
  };
  return {
    startWalkthrough: () => {
      const jobId = crypto.randomUUID();
      jobs.set(jobId, { controller: new AbortController() });
      return { jobId };
    },
    streamWalkthrough: (jobId, requestSignal) => {
      const job = get(jobId);
      if (job.controller.signal.aborted) {
        return emptyStream();
      }
      return run(combineSignals(job.controller.signal, requestSignal));
    },
    cancelWalkthrough: (jobId) => get(jobId).controller.abort(),
  };
};

// The write and live side (drafts, submit, the comment-change stream). Split out
// so createReviewSource stays thin. Throws when the run has no GitHub, which the
// route turns into a 409.
interface WriteSurface {
  draftComment: (body: unknown) => CommentDraft | null;
  listDrafts: () => CommentDraft[];
  submitReview: (payload: { event: ReviewEvent; body?: string }) => Promise<{ htmlUrl: string }>;
  streamCommentDeltas: (signal: AbortSignal) => AsyncIterable<CommentDelta>;
}

// Build the write and live side over the draft store and the injected submit/fetch.
const createWriteSurface = (deps: ReviewSourceDeps, drafts: DraftStore): WriteSurface => ({
  draftComment: (body) => drafts.add(body),
  listDrafts: () => drafts.list(),
  // Submit the drafts as one review, clearing them only after it succeeds so a
  // failed submit keeps them for a retry.
  submitReview: async (payload) => {
    if (deps.submit === undefined) {
      throw new CommentsUnavailableError("Comments are unavailable for this run.");
    }
    const comments = drafts.list();
    const bodyField = payload.body === undefined ? {} : { body: payload.body };
    const result = await deps.submit({ event: payload.event, ...bodyField, comments });
    drafts.clear();
    return { htmlUrl: result.htmlUrl };
  },
  // The poller over the injected fetch, seeded with the comments already served.
  streamCommentDeltas: (signal) => {
    if (deps.fetchComments === undefined) {
      throw new CommentsUnavailableError("Comments are unavailable for this run.");
    }
    return pollCommentDeltas({
      initial: deps.data.comments,
      fetchComments: deps.fetchComments,
      wait: deps.wait,
      intervalMs: deps.intervalMs,
      signal,
    });
  },
});

const createReviewSource = (deps: ReviewSourceDeps): ServerReviewSource => {
  const jobs = createJobManager(deps.runWalkthrough);
  const writes = createWriteSurface(deps, createDraftStore());
  const commentsEnabled = deps.submit !== undefined && deps.fetchComments !== undefined;
  return {
    context: deps.context,
    getReview: () => deps.data,
    listComments: () => deps.data.comments,
    ...jobs,
    ...writes,
    capabilities: { comments: commentsEnabled },
  };
};

export { CommentsUnavailableError, createReviewSource, UnknownJobError };
export type { FetchCommentsFn, ReviewSourceDeps, ServerReviewSource, SubmitFn, WalkthroughRunner };
