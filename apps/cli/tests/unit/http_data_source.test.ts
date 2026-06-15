// Tests for the data source's read and walkthrough paths: it sends the token on
// every call, checks the review and comments responses, streams the walkthrough
// over a fake stream, and aborts on cancel. The write and live-subscription paths
// live in http_data_source_writes.test.ts.

import type { WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it, vi } from "vitest";

import { type Bootstrap, createHttpReviewDataSource } from "../../frontend/http_data_source.js";
import { FIXTURE_CHUNKS, FIXTURE_CONTEXT, FIXTURE_REVIEW } from "../fixtures/review_fixture.js";

// A PR-mode page config.
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

// Build a stream body from the fixture chunks.
const sseBody = (chunks: WalkthroughChunk[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.close();
    },
  });

// A fake fetch that records requests and routes by method+path.
interface Recorded {
  url: string;
  init?: RequestInit | undefined;
}

const fakeFetch = (): { impl: typeof fetch; calls: Recorded[] } => {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/review")) {
      return new Response(JSON.stringify(FIXTURE_REVIEW), { status: 200 });
    }
    if (url.endsWith("/api/comments")) {
      return new Response(JSON.stringify(FIXTURE_REVIEW.comments), { status: 200 });
    }
    if (url.includes("/api/walkthrough") && init?.method === "POST") {
      return new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 });
    }
    if (url.includes("/api/walkthrough") && init?.method === "DELETE") {
      return new Response(JSON.stringify({ cancelled: true }), { status: 200 });
    }
    // GET walkthrough stream.
    return new Response(sseBody(FIXTURE_CHUNKS), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
};

const authOf = (recorded: Recorded): unknown =>
  (recorded.init?.headers as Record<string, string> | undefined)?.["Authorization"];

const collect = async (it: AsyncIterable<WalkthroughChunk>): Promise<WalkthroughChunk[]> => {
  const out: WalkthroughChunk[] = [];
  for await (const chunk of it) {
    out.push(chunk);
  }
  return out;
};

describe("createHttpReviewDataSource", () => {
  it("fetches and validates the review with the bearer header", async () => {
    const { impl, calls } = fakeFetch();
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    const review = await source.getReview();
    expect(review).toEqual(FIXTURE_REVIEW);
    expect(calls[0]?.url).toBe("/api/review");
    expect(authOf(calls[0]!)).toBe("Bearer tok-123");
  });

  it("fetches and validates the comments list", async () => {
    const { impl } = fakeFetch();
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    expect(await source.listComments()).toEqual(FIXTURE_REVIEW.comments);
  });

  it("starts a walkthrough and returns its jobId", async () => {
    const { impl, calls } = fakeFetch();
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    expect(await source.startWalkthrough()).toEqual({ jobId: "job-1" });
    expect(authOf(calls.at(-1)!)).toBe("Bearer tok-123");
  });

  it("streams the walkthrough chunks over the SSE body", async () => {
    const { impl, calls } = fakeFetch();
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    const chunks = await collect(source.streamWalkthrough("job-1"));
    expect(chunks).toEqual(FIXTURE_CHUNKS);
    // The GET stream carried the bearer header and the jobId.
    const streamCall = calls.find(
      (c) => c.url.includes("jobId=job-1") && c.init?.method !== "DELETE",
    );
    expect(streamCall).toBeDefined();
    expect(authOf(streamCall!)).toBe("Bearer tok-123");
  });

  it("cancels by DELETEing the job with the bearer header", async () => {
    const { impl, calls } = fakeFetch();
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    await source.cancelWalkthrough("job-1");
    const del = calls.find((c) => c.init?.method === "DELETE");
    expect(del?.url).toContain("jobId=job-1");
    expect(authOf(del!)).toBe("Bearer tok-123");
  });

  it("aborts the in-flight stream fetch on cancel", async () => {
    // A stream that stays open; cancel must abort the fetch signal.
    const signals: (AbortSignal | null)[] = [];
    const impl = (async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ cancelled: true }), { status: 200 });
      }
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 });
      }
      signals.push(init?.signal ?? null);
      return new Response(sseBody(FIXTURE_CHUNKS), { status: 200 });
    }) as typeof fetch;
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    // Kick off the stream (start consuming so the fetch runs), then cancel.
    const iterator = source.streamWalkthrough("job-1")[Symbol.asyncIterator]();
    await iterator.next();
    await source.cancelWalkthrough("job-1");
    expect(signals[0]?.aborted).toBe(true);
  });

  it("throws HTTP errors for a non-ok review response", async () => {
    const impl = vi.fn(
      async () => new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    await expect(source.getReview()).rejects.toThrow(/HTTP 500/);
  });

  it("throws when start walkthrough returns a non-ok status", async () => {
    const impl = vi.fn(async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    await expect(source.startWalkthrough()).rejects.toThrow(/HTTP 503/);
  });

  it("throws when the stream response is not ok", async () => {
    const impl = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    await expect(collect(source.streamWalkthrough("job-1"))).rejects.toThrow(/HTTP 500/);
  });

  it("throws when the stream response has no body", async () => {
    // A 204 has a null body, which the stream reader cannot consume.
    const impl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    await expect(collect(source.streamWalkthrough("job-1"))).rejects.toThrow();
  });

  it("derives the context and the comments capability from the bootstrap", () => {
    const { impl } = fakeFetch();
    const source = createHttpReviewDataSource({
      bootstrap: BOOTSTRAP,
      fetchImpl: impl,
    });
    // The context comes from the page config.
    expect(source.context).toEqual({
      sessionId: FIXTURE_CONTEXT.sessionId,
      mode: "pr",
      viewer: FIXTURE_CONTEXT.viewer,
      repo: FIXTURE_CONTEXT.repo,
    });
    expect(source.capabilities).toEqual({ comments: true });
  });

  it("derives comments=false in local-path mode (no 409-on-submit write UI)", () => {
    const { impl } = fakeFetch();
    const source = createHttpReviewDataSource({
      bootstrap: {
        token: "tok-123",
        apiBase: "",
        mode: "path",
        capabilities: { comments: false },
        context: { sessionId: "s-path", repo: null, viewer: null },
      },
      fetchImpl: impl,
    });
    expect(source.context.mode).toBe("path");
    expect(source.capabilities).toEqual({ comments: false });
  });
});
