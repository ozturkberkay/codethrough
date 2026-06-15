// Tests for the review source: the read methods return the data, the job lifecycle
// (start, stream, cancel) works, and the write side (draft, submit, clear), the
// live comment stream, and the comments capability all work. Every helper is a
// fake, so no engine, GitHub, or timer runs.

import type { Comment, CommentDelta, CommentDraft, WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import {
  CommentsUnavailableError,
  createReviewSource,
  type ReviewSourceDeps,
  UnknownJobError,
  type WalkthroughRunner,
} from "../../src/server/review_source.js";
import { FIXTURE_CHUNKS, FIXTURE_CONTEXT, FIXTURE_REVIEW } from "../fixtures/review_fixture.js";

// Collect an async iterable into an array.
const collect = async <T>(it: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of it) {
    out.push(item);
  }
  return out;
};

// A fake runner that yields the fixture chunks, recording the signal it got.
const fakeRunner = (): { run: WalkthroughRunner; signals: AbortSignal[] } => {
  const signals: AbortSignal[] = [];
  const run: WalkthroughRunner = (signal) => {
    signals.push(signal);
    return (async function* yieldChunks(): AsyncIterable<WalkthroughChunk> {
      for (const chunk of FIXTURE_CHUNKS) {
        yield chunk;
      }
    })();
  };
  return { run, signals };
};

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

// Build a source over the fixture review. `wait` is immediate by default and the
// interval only matters when a test drives the poll loop. Extra deps merge on top.
const makeSource = (runWalkthrough: WalkthroughRunner, over: Partial<ReviewSourceDeps> = {}) =>
  createReviewSource({
    data: FIXTURE_REVIEW,
    context: FIXTURE_CONTEXT,
    runWalkthrough,
    wait: async () => {},
    intervalMs: 1_000,
    ...over,
  });

describe("createReviewSource: reads", () => {
  it("returns the ingested review, comments, and context", () => {
    const { run } = fakeRunner();
    const source = makeSource(run);
    expect(source.getReview()).toBe(FIXTURE_REVIEW);
    expect(source.listComments()).toBe(FIXTURE_REVIEW.comments);
    expect(source.context).toBe(FIXTURE_CONTEXT);
  });
});

describe("createReviewSource: walkthrough lifecycle", () => {
  it("starts a job with a unique id and streams its chunks", async () => {
    const { run, signals } = fakeRunner();
    const source = makeSource(run);
    const { jobId } = source.startWalkthrough();
    expect(jobId).toMatch(/[0-9a-f-]{36}/);

    const chunks = await collect(source.streamWalkthrough(jobId));
    expect(chunks).toEqual(FIXTURE_CHUNKS);
    // The runner received the job's abort signal.
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
  });

  it("gives each start a distinct job id", () => {
    const { run } = fakeRunner();
    const source = makeSource(run);
    expect(source.startWalkthrough().jobId).not.toBe(source.startWalkthrough().jobId);
  });

  it("aborts the signal on cancel and then streams nothing", async () => {
    const { run, signals } = fakeRunner();
    const source = makeSource(run);
    const { jobId } = source.startWalkthrough();
    source.cancelWalkthrough(jobId);
    const chunks = await collect(source.streamWalkthrough(jobId));
    expect(chunks).toEqual([]);
    // The runner was never invoked for a cancelled job.
    expect(signals).toHaveLength(0);
  });

  it("throws UnknownJobError for an unstarted stream or cancel", () => {
    const { run } = fakeRunner();
    const source = makeSource(run);
    expect(() => source.streamWalkthrough("nope")).toThrow(UnknownJobError);
    expect(() => source.cancelWalkthrough("nope")).toThrow(UnknownJobError);
  });

  it("aborts the run when the REQUEST signal fires (client disconnect)", () => {
    const { run, signals } = fakeRunner();
    const source = makeSource(run);
    const { jobId } = source.startWalkthrough();
    const request = new AbortController();
    // The runner gets a combined signal; aborting the request alone aborts it, so a
    // dropped connection stops the run, not just a cancel.
    source.streamWalkthrough(jobId, request.signal);
    expect(signals[0]?.aborted).toBe(false);
    request.abort();
    expect(signals[0]?.aborted).toBe(true);
  });

  it("aborts the run when the JOB is cancelled even with a request signal present", () => {
    const { run, signals } = fakeRunner();
    const source = makeSource(run);
    const { jobId } = source.startWalkthrough();
    const request = new AbortController();
    source.streamWalkthrough(jobId, request.signal);
    expect(signals[0]?.aborted).toBe(false);
    // A DELETE cancel still aborts the combined signal.
    source.cancelWalkthrough(jobId);
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe("createReviewSource: drafts + submit", () => {
  it("stores a valid draft and lists it; rejects an invalid one", () => {
    const { run } = fakeRunner();
    const source = makeSource(run, {
      submit: async () => ({ htmlUrl: "x" }),
      fetchComments: async () => [],
    });

    expect(source.draftComment(VALID_DRAFT)).toEqual(VALID_DRAFT);
    expect(source.draftComment({ not: "a draft" })).toBeNull();
    // Only the valid draft was stored.
    expect(source.listDrafts()).toEqual([VALID_DRAFT]);
  });

  it("submits the stored drafts as one review and clears them on success", async () => {
    const submitCalls: { event: string; comments: CommentDraft[] }[] = [];
    const { run } = fakeRunner();
    const source = makeSource(run, {
      submit: async (payload) => {
        submitCalls.push({ event: payload.event, comments: payload.comments ?? [] });
        return { htmlUrl: "https://example.com/r/3" };
      },
      fetchComments: async () => [],
    });
    source.draftComment(VALID_DRAFT);

    const result = await source.submitReview({ event: "COMMENT", body: "Notes." });
    expect(result).toEqual({ htmlUrl: "https://example.com/r/3" });
    // The stored draft was forwarded, then cleared.
    expect(submitCalls).toEqual([{ event: "COMMENT", comments: [VALID_DRAFT] }]);
    expect(source.listDrafts()).toEqual([]);
  });

  it("keeps the drafts when the submit fails (so a retry still has them)", async () => {
    const { run } = fakeRunner();
    const source = makeSource(run, {
      submit: async () => {
        await Promise.resolve();
        throw new Error("network");
      },
      fetchComments: async () => [],
    });
    source.draftComment(VALID_DRAFT);

    await expect(source.submitReview({ event: "COMMENT" })).rejects.toThrow(/network/);
    expect(source.listDrafts()).toEqual([VALID_DRAFT]);
  });

  it("omits an absent body from the submit payload", async () => {
    let seen: { event: string; body?: string } | null = null;
    const { run } = fakeRunner();
    const source = makeSource(run, {
      submit: async (payload) => {
        seen = {
          event: payload.event,
          ...(payload.body === undefined ? {} : { body: payload.body }),
        };
        return { htmlUrl: "x" };
      },
      fetchComments: async () => [],
    });
    await source.submitReview({ event: "APPROVE" });
    expect(seen).toEqual({ event: "APPROVE" });
  });

  it("reports comments unavailable (capability false) in path mode", () => {
    const { run } = fakeRunner();
    // No submit or fetch helpers means path mode (no GitHub).
    const source = makeSource(run);
    expect(source.capabilities).toEqual({ comments: false });
    expect(() => source.streamCommentDeltas(new AbortController().signal)).toThrow(
      CommentsUnavailableError,
    );
  });

  it("rejects a submit in path mode with CommentsUnavailableError", async () => {
    const { run } = fakeRunner();
    const source = makeSource(run);
    await expect(source.submitReview({ event: "COMMENT" })).rejects.toThrow(
      CommentsUnavailableError,
    );
  });

  it("reports comments available (capability true) when both collaborators are present", () => {
    const { run } = fakeRunner();
    const source = makeSource(run, {
      submit: async () => ({ htmlUrl: "x" }),
      fetchComments: async () => [],
    });
    expect(source.capabilities).toEqual({ comments: true });
  });
});

describe("createReviewSource: live comments stream", () => {
  // A fake fetch that returns the queued lists in turn, aborting once they run out
  // so the poll loop ends.
  const queuedFetch = (
    snapshots: Comment[][],
    controller: AbortController,
  ): (() => Promise<Comment[]>) => {
    let index = 0;
    return async () => {
      const snapshot = snapshots[index] ?? [];
      index += 1;
      if (index >= snapshots.length) {
        controller.abort();
      }
      return await Promise.resolve(snapshot);
    };
  };

  it("emits only changed deltas off the seeded snapshot", async () => {
    const controller = new AbortController();
    const { run } = fakeRunner();
    // The seed is the fixture's one comment; the first poll adds another.
    const seeded = FIXTURE_REVIEW.comments[0]!;
    const added: Comment = { ...seeded, id: "c2", body: "A new comment." };
    const source = makeSource(run, {
      submit: async () => ({ htmlUrl: "x" }),
      fetchComments: queuedFetch([[seeded, added]], controller),
    });

    const deltas = await collect<CommentDelta>(source.streamCommentDeltas(controller.signal));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.added.map((c) => c.id)).toEqual(["c2"]);
    expect(deltas[0]?.updated).toEqual([]);
    expect(deltas[0]?.removed).toEqual([]);
  });

  it("skips an unchanged poll (no delta frame)", async () => {
    const controller = new AbortController();
    const { run } = fakeRunner();
    const seeded = FIXTURE_REVIEW.comments[0]!;
    const source = makeSource(run, {
      submit: async () => ({ htmlUrl: "x" }),
      // Two identical lists: the first matches the seed (no change), the second ends
      // the loop. No change should be emitted.
      fetchComments: queuedFetch([[seeded], [seeded]], controller),
    });

    const deltas = await collect<CommentDelta>(source.streamCommentDeltas(controller.signal));
    expect(deltas).toEqual([]);
  });
});
