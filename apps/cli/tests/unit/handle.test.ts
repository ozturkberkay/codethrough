// Tests for the decision dispatcher: every API route maps to the right Response, a
// reject becomes its status and reason, and the source errors become a 404 or 409
// instead of throwing. Driven with a fake source, so no socket.

import type {
  Comment,
  CommentDelta,
  CommentDraft,
  ReviewData,
  WalkthroughChunk,
} from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { handleDecision } from "../../src/server/handle.js";
import {
  CommentsUnavailableError,
  type ServerReviewSource,
  UnknownJobError,
} from "../../src/server/review_source.js";
import { FIXTURE_REVIEW } from "../fixtures/review_fixture.js";

// A valid draft body.
const VALID_DRAFT: CommentDraft = {
  path: "src/greet.ts",
  body: "Nit.",
  line: 2,
  side: "RIGHT",
  startLine: null,
  startSide: null,
  subjectType: "line",
};

// A fake source with default methods; each test overrides what it exercises.
const fakeSource = (over: Partial<ServerReviewSource> = {}): ServerReviewSource => ({
  context: { sessionId: "s", mode: "pr", viewer: null, repo: null },
  getReview: (): ReviewData => FIXTURE_REVIEW,
  listComments: (): Comment[] => FIXTURE_REVIEW.comments,
  startWalkthrough: () => ({ jobId: "job-1" }),
  streamWalkthrough: (): AsyncIterable<WalkthroughChunk> =>
    (async function* gen(): AsyncIterable<WalkthroughChunk> {
      yield { type: "done" };
    })(),
  cancelWalkthrough: () => {},
  draftComment: (body) => (body === null ? null : VALID_DRAFT),
  listDrafts: (): CommentDraft[] => [VALID_DRAFT],
  submitReview: async () => await Promise.resolve({ htmlUrl: "https://example.com/r/1" }),
  streamCommentDeltas: (): AsyncIterable<CommentDelta> =>
    (async function* gen(): AsyncIterable<CommentDelta> {
      // Intentionally yields nothing by default.
    })(),
  capabilities: { comments: true },
  ...over,
});

// Resolve a decision to its Response (the writes/stream return a promise).
const dispatch = async (...args: Parameters<typeof handleDecision>): Promise<Response> =>
  await handleDecision(...args);

describe("handleDecision", () => {
  it("maps a reject decision to its status + reason", async () => {
    const res = await dispatch({ kind: "reject", status: 401, reason: "nope" }, fakeSource());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("nope");
  });

  it("serves the review", async () => {
    const res = await dispatch({ kind: "api", route: "review" }, fakeSource());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FIXTURE_REVIEW);
  });

  it("serves the comments", async () => {
    const res = await dispatch({ kind: "api", route: "comments" }, fakeSource());
    expect(await res.json()).toEqual(FIXTURE_REVIEW.comments);
  });

  it("starts a walkthrough and returns the jobId", async () => {
    const res = await dispatch({ kind: "api", route: "walkthrough_start" }, fakeSource());
    expect(await res.json()).toEqual({ jobId: "job-1" });
  });

  it("streams a walkthrough", async () => {
    const res = await dispatch(
      { kind: "api", route: "walkthrough_stream", jobId: "job-1" },
      fakeSource(),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toContain('"type":"done"');
  });

  it("cancels a walkthrough", async () => {
    let cancelled = "";
    const res = await dispatch(
      { kind: "api", route: "walkthrough_cancel", jobId: "job-1" },
      fakeSource({
        cancelWalkthrough: (jobId) => {
          cancelled = jobId;
        },
      }),
    );
    expect(await res.json()).toEqual({ cancelled: true });
    expect(cancelled).toBe("job-1");
  });

  it("maps an UnknownJobError on stream to a 404", async () => {
    const res = await dispatch(
      { kind: "api", route: "walkthrough_stream", jobId: "gone" },
      fakeSource({
        streamWalkthrough: () => {
          throw new UnknownJobError("no job gone");
        },
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("no job gone");
  });

  it("maps an UnknownJobError on cancel to a 404", async () => {
    const res = await dispatch(
      { kind: "api", route: "walkthrough_cancel", jobId: "gone" },
      fakeSource({
        cancelWalkthrough: () => {
          throw new UnknownJobError("no job gone");
        },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("rethrows a non-UnknownJobError from the source", () => {
    expect(() =>
      handleDecision(
        { kind: "api", route: "walkthrough_cancel", jobId: "x" },
        fakeSource({
          cancelWalkthrough: () => {
            throw new Error("unexpected");
          },
        }),
      ),
    ).toThrow(/unexpected/);
  });
});

describe("handleDecision: write routes", () => {
  it("lists the current drafts", async () => {
    const res = await dispatch({ kind: "api", route: "drafts" }, fakeSource());
    expect(await res.json()).toEqual([VALID_DRAFT]);
  });

  it("accepts a valid draft with 201, echoing the parsed draft", async () => {
    const res = await dispatch({ kind: "api", route: "draft_comment" }, fakeSource(), {
      body: VALID_DRAFT,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ draft: VALID_DRAFT });
  });

  it("rejects an invalid draft body with 400", async () => {
    // The fake source returns null for a null body (an invalid draft).
    const res = await dispatch({ kind: "api", route: "draft_comment" }, fakeSource(), {
      body: null,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("invalid comment draft");
  });

  it("submits a review and returns the created review url", async () => {
    let submitted: { event: string; body?: string } | null = null;
    const res = await dispatch(
      { kind: "api", route: "submit_review" },
      fakeSource({
        submitReview: async (payload) => {
          submitted = payload;
          return await Promise.resolve({ htmlUrl: "https://example.com/r/42" });
        },
      }),
      { body: { event: "APPROVE" } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ htmlUrl: "https://example.com/r/42" });
    expect(submitted).toEqual({ event: "APPROVE" });
  });

  it("passes an optional body through to the submit", async () => {
    let submitted: { event: string; body?: string } | null = null;
    await dispatch(
      { kind: "api", route: "submit_review" },
      fakeSource({
        submitReview: async (payload) => {
          submitted = payload;
          return await Promise.resolve({ htmlUrl: "x" });
        },
      }),
      { body: { event: "COMMENT", body: "A few notes." } },
    );
    expect(submitted).toEqual({ event: "COMMENT", body: "A few notes." });
  });

  it("rejects a submit with an unknown event with 400", async () => {
    const res = await dispatch({ kind: "api", route: "submit_review" }, fakeSource(), {
      body: { event: "LGTM" },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("invalid review submit body");
  });

  it("rejects a submit with a missing body with 400", async () => {
    const res = await dispatch({ kind: "api", route: "submit_review" }, fakeSource(), {
      body: undefined,
    });
    expect(res.status).toBe(400);
  });

  it("maps a CommentsUnavailableError on submit to a 409", async () => {
    const res = await dispatch(
      { kind: "api", route: "submit_review" },
      fakeSource({
        submitReview: () => Promise.reject(new CommentsUnavailableError("no github")),
      }),
      { body: { event: "COMMENT" } },
    );
    expect(res.status).toBe(409);
    expect(await res.text()).toBe("no github");
  });

  it("rethrows a non-CommentsUnavailableError from submit", async () => {
    await expect(
      dispatch(
        { kind: "api", route: "submit_review" },
        fakeSource({
          submitReview: () => Promise.reject(new Error("boom")),
        }),
        { body: { event: "COMMENT" } },
      ),
    ).rejects.toThrow(/boom/);
  });
});

describe("handleDecision: comments stream", () => {
  it("streams the comments deltas as SSE", async () => {
    const delta: CommentDelta = {
      added: [FIXTURE_REVIEW.comments[0]!],
      updated: [],
      removed: [],
    };
    const res = await dispatch(
      { kind: "api", route: "comments_stream" },
      fakeSource({
        streamCommentDeltas: (): AsyncIterable<CommentDelta> =>
          (async function* gen(): AsyncIterable<CommentDelta> {
            yield delta;
          })(),
      }),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toContain('"added"');
  });

  it("maps a CommentsUnavailableError on the stream subscribe to a 409", async () => {
    const res = await dispatch(
      { kind: "api", route: "comments_stream" },
      fakeSource({
        streamCommentDeltas: () => {
          throw new CommentsUnavailableError("comments unavailable");
        },
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.text()).toBe("comments unavailable");
  });

  it("rethrows a non-CommentsUnavailableError from the stream subscribe", () => {
    expect(() =>
      handleDecision(
        { kind: "api", route: "comments_stream" },
        fakeSource({
          streamCommentDeltas: () => {
            throw new Error("unexpected");
          },
        }),
      ),
    ).toThrow(/unexpected/);
  });
});
