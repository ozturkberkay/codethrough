// Tests for the stream reader: it yields the chunks carried by a byte stream of
// events, handles an event split across reads, and stops when the signal aborts.
// The stream is built from a list of pieces, so no real network.

import type { CommentDelta, WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { createCommentDeltaParser } from "../../frontend/sse_parse.js";
import { readSseStream, readSseStreamWith } from "../../frontend/sse_stream.js";

const encoder = new TextEncoder();

// Build a ReadableStream<Uint8Array> that emits the given text pieces in order.
const streamOf = (pieces: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const piece of pieces) {
        controller.enqueue(encoder.encode(piece));
      }
      controller.close();
    },
  });

const collect = async (it: AsyncIterable<WalkthroughChunk>): Promise<WalkthroughChunk[]> => {
  const out: WalkthroughChunk[] = [];
  for await (const chunk of it) {
    out.push(chunk);
  }
  return out;
};

const summary: WalkthroughChunk = {
  type: "summary",
  summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d"] },
};
const done: WalkthroughChunk = { type: "done" };

describe("readSseStream", () => {
  it("yields each chunk from a byte stream of frames", async () => {
    const body = streamOf([
      `data: ${JSON.stringify(summary)}\n\n`,
      `data: ${JSON.stringify(done)}\n\n`,
    ]);
    expect(await collect(readSseStream(body))).toEqual([summary, done]);
  });

  it("reassembles a frame split across two byte reads", async () => {
    const frame = `data: ${JSON.stringify(summary)}\n\n`;
    const mid = Math.floor(frame.length / 2);
    const body = streamOf([frame.slice(0, mid), frame.slice(mid)]);
    expect(await collect(readSseStream(body))).toEqual([summary]);
  });

  it("flushes a final frame with no trailing blank line", async () => {
    const body = streamOf([`data: ${JSON.stringify(summary)}`]);
    expect(await collect(readSseStream(body))).toEqual([summary]);
  });

  it("stops reading once the signal aborts", async () => {
    const controller = new AbortController();
    // A stream that would emit a second frame only after we abort.
    const body = new ReadableStream<Uint8Array>({
      start: (streamController) => {
        streamController.enqueue(encoder.encode(`data: ${JSON.stringify(summary)}\n\n`));
        // Leave the stream open; aborting cancels the reader.
      },
    });
    const out: WalkthroughChunk[] = [];
    for await (const chunk of readSseStream(body, controller.signal)) {
      out.push(chunk);
      controller.abort();
    }
    expect(out).toEqual([summary]);
  });
});

describe("readSseStreamWith (comments delta)", () => {
  const delta: CommentDelta = { added: [], updated: [], removed: [] };

  const collectDeltas = async (it: AsyncIterable<CommentDelta>): Promise<CommentDelta[]> => {
    const out: CommentDelta[] = [];
    for await (const item of it) {
      out.push(item);
    }
    return out;
  };

  it("yields each comments delta parsed by the injected parser", async () => {
    const body = streamOf([`data: ${JSON.stringify(delta)}\n\n`]);
    expect(await collectDeltas(readSseStreamWith(body, createCommentDeltaParser()))).toEqual([
      delta,
    ]);
  });
});
