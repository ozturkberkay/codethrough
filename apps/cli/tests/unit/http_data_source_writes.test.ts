// Tests for the data source's write and live paths: drafting a comment, listing
// drafts, submitting a review, and the live-comments subscription (reading the
// stream and passing each change to the listener). The read and walkthrough paths
// live in http_data_source.test.ts. fetch is injected, so no real network.

import type { CommentDelta, CommentDraft } from "@codethrough/schema";
import { describe, expect, it, vi } from "vitest";

import { type Bootstrap, createHttpReviewDataSource } from "../../frontend/http_data_source.js";
import { FIXTURE_CONTEXT, FIXTURE_REVIEW } from "../fixtures/review_fixture.js";

const BOOTSTRAP: Bootstrap = {
  token: "tok-123",
  apiBase: "",
  mode: "pr",
  capabilities: { comments: true },
  context: {
    sessionId: FIXTURE_CONTEXT.sessionId,
    repo: FIXTURE_CONTEXT.repo,
    viewer: FIXTURE_CONTEXT.viewer,
  },
};

const encoder = new TextEncoder();

// A valid draft the write tests post and the drafts list returns.
const FIXTURE_DRAFTS: CommentDraft[] = [
  {
    path: "src/a.ts",
    body: "Nit.",
    line: 2,
    side: "RIGHT",
    startLine: null,
    startSide: null,
    subjectType: "line",
  },
];

// A change the comments stream delivers, framed below.
const STREAM_DELTA: CommentDelta = {
  added: [FIXTURE_REVIEW.comments[0]!],
  updated: [],
  removed: [],
};

// Build a stream body from a single change.
const deltaBody = (delta: CommentDelta): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
      controller.close();
    },
  });

interface Recorded {
  url: string;
  init?: RequestInit | undefined;
}

// A fake fetch that routes the write and stream endpoints, recording each request.
const fakeFetch = (): { impl: typeof fetch; calls: Recorded[] } => {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/comments/stream")) {
      return new Response(deltaBody(STREAM_DELTA), { status: 200 });
    }
    if (url.endsWith("/api/comments/draft") && init?.method === "POST") {
      return new Response(JSON.stringify({ draft: JSON.parse(String(init.body)) }), {
        status: 201,
      });
    }
    if (url.endsWith("/api/drafts")) {
      return new Response(JSON.stringify(FIXTURE_DRAFTS), { status: 200 });
    }
    // POST /api/review/submit.
    return new Response(JSON.stringify({ htmlUrl: "https://example.com/r/1" }), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
};

const authOf = (recorded: Recorded): unknown =>
  (recorded.init?.headers as Record<string, string> | undefined)?.["Authorization"];

const makeSource = (fetchImpl: typeof fetch) =>
  createHttpReviewDataSource({ bootstrap: BOOTSTRAP, fetchImpl });

describe("createHttpReviewDataSource: write paths", () => {
  it("POSTs a draft with the bearer header + JSON body", async () => {
    const { impl, calls } = fakeFetch();
    const source = makeSource(impl);
    await source.draftComment(FIXTURE_DRAFTS[0]!);
    const post = calls.find((c) => c.url.endsWith("/api/comments/draft"));
    expect(post?.init?.method).toBe("POST");
    expect(authOf(post!)).toBe("Bearer tok-123");
    expect(JSON.parse(String(post?.init?.body))).toEqual(FIXTURE_DRAFTS[0]);
  });

  it("throws when the draft POST is rejected", async () => {
    const impl = (async () => new Response("bad", { status: 400 })) as unknown as typeof fetch;
    await expect(makeSource(impl).draftComment(FIXTURE_DRAFTS[0]!)).rejects.toThrow(/HTTP 400/);
  });

  it("lists the drafts, validating the response", async () => {
    const { impl } = fakeFetch();
    expect(await makeSource(impl).listDrafts()).toEqual(FIXTURE_DRAFTS);
  });

  it("POSTs a review submit with the event + body", async () => {
    const { impl, calls } = fakeFetch();
    await makeSource(impl).submitReview({ event: "COMMENT", body: "Notes." });
    const post = calls.find((c) => c.url.endsWith("/api/review/submit"));
    expect(post?.init?.method).toBe("POST");
    expect(authOf(post!)).toBe("Bearer tok-123");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ event: "COMMENT", body: "Notes." });
  });

  it("throws when the submit POST is rejected", async () => {
    const impl = (async () => new Response("no", { status: 409 })) as unknown as typeof fetch;
    await expect(makeSource(impl).submitReview({ event: "APPROVE" })).rejects.toThrow(/HTTP 409/);
  });
});

describe("createHttpReviewDataSource: live comments subscription", () => {
  it("delivers a delta from the comments stream to the listener", async () => {
    const { impl } = fakeFetch();
    const source = makeSource(impl);
    const seen: CommentDelta[] = [];
    const unsubscribe = source.subscribeComments?.((delta) => seen.push(delta));
    // The background loop delivers the one frame later, so wait for it.
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    unsubscribe?.();
    expect(seen[0]?.added.map((c) => c.id)).toEqual([FIXTURE_REVIEW.comments[0]!.id]);
  });

  it("aborts the stream fetch on unsubscribe", async () => {
    const signals: (AbortSignal | null)[] = [];
    const impl = (async (_input: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal ?? null);
      // A never-closing stream so unsubscribe must abort it.
      return new Response(new ReadableStream<Uint8Array>({ start: () => {} }), { status: 200 });
    }) as typeof fetch;
    const unsubscribe = makeSource(impl).subscribeComments?.(() => {});
    // Let the fetch start, then unsubscribe.
    await Promise.resolve();
    unsubscribe?.();
    expect(signals[0]?.aborted).toBe(true);
  });

  it("does not throw when the stream response is not ok", async () => {
    const impl = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    // A failed subscribe must not reject the caller; it just delivers nothing.
    const unsubscribe = makeSource(impl).subscribeComments?.(() => {
      throw new Error("should not be called");
    });
    await Promise.resolve();
    unsubscribe?.();
    expect(unsubscribe).toBeDefined();
  });
});
