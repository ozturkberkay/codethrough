// Build the HTTP responses for each route. Keeping them here puts the header
// rules (the no-referrer header on every response, content types, stream framing)
// in one tested place.
//
// Secrets never reach these builders: they only get review data, comments, or
// chunks, so a response cannot carry one. A leak test proves this.

import type {
  Comment,
  CommentDelta,
  CommentDraft,
  ReviewData,
  WalkthroughChunk,
} from "@codethrough/schema";

import { serializeChunk, serializeCommentDelta, serializeErrorFrame } from "./sse.js";

// Headers on every response: no referrer, and never cache an API response.
const BASE_HEADERS: Record<string, string> = {
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const JSON_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  "Content-Type": "application/json; charset=utf-8",
};

const SSE_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  "Content-Type": "text/event-stream; charset=utf-8",
  Connection: "keep-alive",
};

// The status for a stored draft (something new was created).
const HTTP_CREATED = 201;

// A JSON response with our base headers added on top.
const jsonResponse = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: JSON_HEADERS });

// A plain-text rejection. The reason is the body so a developer can see why.
const rejectResponse = (status: number, reason: string): Response =>
  new Response(reason, {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });

const reviewResponse = (data: ReviewData): Response => jsonResponse(data);

const commentsResponse = (comments: Comment[]): Response => jsonResponse(comments);

const startResponse = (jobId: string): Response => jsonResponse({ jobId });

const cancelResponse = (): Response => jsonResponse({ cancelled: true });

// The current draft list (the write side's read).
const draftsResponse = (drafts: CommentDraft[]): Response => jsonResponse(drafts);

// A 201 acknowledging a stored draft, echoing the parsed draft back.
const draftAcceptedResponse = (draft: CommentDraft): Response =>
  jsonResponse({ draft }, HTTP_CREATED);

// The created review's url after a successful submit.
const reviewSubmittedResponse = (htmlUrl: string): Response => jsonResponse({ htmlUrl });

// The message for a stream failure: the error's message, or a generic fallback.
const streamErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "stream failed";

// Stream a walkthrough. Each chunk is framed and sent; an error part-way through
// is sent as a final error frame so the client sees it instead of a silent close.
const walkthroughResponse = (chunks: AsyncIterable<WalkthroughChunk>): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      try {
        for await (const chunk of chunks) {
          controller.enqueue(encoder.encode(serializeChunk(chunk)));
        }
      } catch (error) {
        controller.enqueue(encoder.encode(serializeErrorFrame(streamErrorMessage(error))));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
};

// Stream the live comment changes. Each change is framed and sent; an error (like
// a failed re-fetch) just ends the stream, and the frontend keeps its last
// comments.
const commentStreamResponse = (deltas: AsyncIterable<CommentDelta>): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      try {
        for await (const delta of deltas) {
          controller.enqueue(encoder.encode(serializeCommentDelta(delta)));
        }
      } catch {
        // A failed poll ends the stream; the client keeps its last comments.
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
};

export {
  BASE_HEADERS,
  cancelResponse,
  commentStreamResponse,
  commentsResponse,
  draftAcceptedResponse,
  draftsResponse,
  jsonResponse,
  rejectResponse,
  reviewSubmittedResponse,
  streamErrorMessage,
  reviewResponse,
  startResponse,
  walkthroughResponse,
};
