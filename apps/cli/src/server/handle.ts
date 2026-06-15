// Turn a route decision into a Response using the review source. This covers
// reject plus every API route; the serve shell handles static files (it needs
// file reads).
//
// The two POST routes that send a body (draft and submit) get the parsed body
// from the shell. Submit is async, so this can return a promise.
//
// It imports every response builder on purpose, so the dependency-count rule is off.
/* oxlint-disable import/max-dependencies */

import { object, optional, safeParse, string } from "valibot";
import { type ReviewEvent, ReviewEvent as ReviewEventSchema } from "@codethrough/schema";

import {
  CommentsUnavailableError,
  type ServerReviewSource,
  UnknownJobError,
} from "./review_source.js";
import type { RouteDecision } from "./router.js";
import {
  cancelResponse,
  commentStreamResponse,
  commentsResponse,
  draftAcceptedResponse,
  draftsResponse,
  rejectResponse,
  reviewResponse,
  reviewSubmittedResponse,
  startResponse,
  walkthroughResponse,
} from "./responses.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

// Run a job action, turning an unknown-job error into a 404 instead of throwing.
const guardJob = (action: () => Response): Response => {
  try {
    return action();
  } catch (error) {
    if (error instanceof UnknownJobError) {
      return rejectResponse(HTTP_NOT_FOUND, error.message);
    }
    throw error;
  }
};

// Run a comments action, turning a "comments unavailable" error (path mode, no
// GitHub) into a 409 so the UI can disable the control instead of crashing.
const guardComments = (action: () => Response): Response => {
  try {
    return action();
  } catch (error) {
    if (error instanceof CommentsUnavailableError) {
      return rejectResponse(HTTP_CONFLICT, error.message);
    }
    throw error;
  }
};

// Validate and store a posted draft. A bad body is a 400; a stored draft is a 201
// echoing it back.
const handleDraft = (source: ServerReviewSource, body: unknown): Response => {
  const draft = source.draftComment(body);
  return draft === null
    ? rejectResponse(HTTP_BAD_REQUEST, "invalid comment draft")
    : draftAcceptedResponse(draft);
};

// The submit body shape: a required review event and an optional summary. A bad
// body is a 400 before it ever reaches GitHub.
const SubmitBody = object({ event: ReviewEventSchema, body: optional(string()) });

// Build the submit payload, dropping `body` when it is absent (the source's
// optional field rejects an explicit undefined).
const toSubmitPayload = (parsed: {
  event: ReviewEvent;
  body?: string | undefined;
}): {
  event: ReviewEvent;
  body?: string;
} =>
  parsed.body === undefined ? { event: parsed.event } : { event: parsed.event, body: parsed.body };

// Submit the stored drafts as one review. A bad event is a 400; a path-mode run
// (no GitHub) is a 409. On success it returns the review's url.
const handleSubmit = async (source: ServerReviewSource, body: unknown): Promise<Response> => {
  const parsed = safeParse(SubmitBody, body);
  if (!parsed.success) {
    return rejectResponse(HTTP_BAD_REQUEST, "invalid review submit body");
  }
  try {
    const result = await source.submitReview(toSubmitPayload(parsed.output));
    return reviewSubmittedResponse(result.htmlUrl);
  } catch (error) {
    if (error instanceof CommentsUnavailableError) {
      return rejectResponse(HTTP_CONFLICT, error.message);
    }
    throw error;
  }
};

// The extra inputs a POST or stream route needs: the parsed body and the request
// signal (which fires on disconnect so the comments poller stops). Both optional;
// plain GET routes use neither.
interface DecisionContext {
  body?: unknown;
  signal?: AbortSignal;
}

// Build the Response for an api or reject decision. The caller never passes a
// static decision (the shell serves those).
const handleDecision = (
  decision: Exclude<RouteDecision, { kind: "static" }>,
  source: ServerReviewSource,
  context: DecisionContext = {},
): Response | Promise<Response> => {
  if (decision.kind === "reject") {
    return rejectResponse(decision.status, decision.reason);
  }
  switch (decision.route) {
    case "review": {
      return reviewResponse(source.getReview());
    }
    case "comments": {
      return commentsResponse(source.listComments());
    }
    case "comments_stream": {
      const signal = context.signal ?? new AbortController().signal;
      return guardComments(() => commentStreamResponse(source.streamCommentDeltas(signal)));
    }
    case "drafts": {
      return draftsResponse(source.listDrafts());
    }
    case "draft_comment": {
      return handleDraft(source, context.body);
    }
    case "submit_review": {
      return handleSubmit(source, context.body);
    }
    case "walkthrough_start": {
      return startResponse(source.startWalkthrough().jobId);
    }
    case "walkthrough_stream": {
      // Pass the request signal so a dropped connection stops the engine run, not
      // just the local reading.
      return guardJob(() =>
        walkthroughResponse(source.streamWalkthrough(decision.jobId, context.signal)),
      );
    }
    // Only walkthrough_cancel is left.
    default: {
      return guardJob(() => {
        source.cancelWalkthrough(decision.jobId);
        return cancelResponse();
      });
    }
  }
};

export { handleDecision };
export type { DecisionContext };
