// Read a fetch response body (a byte stream) as events and yield the values it
// carries. Turns each read into text, feeds it to the parser, yields the completed
// events, and flushes the tail at the end. A signal lets the caller cancel.
//
// This is why we read streams with fetch and not EventSource: EventSource cannot
// send our token. It works for both streams. The body and parser are injected, so
// it is tested with a fake stream built from a list of pieces.

import type { WalkthroughChunk } from "@codethrough/schema";

import { createSseParser, type SseParser } from "./sse_parse.js";

// Yield each value from a byte stream of events, parsed by the given parser. Stops
// when the stream ends or the signal aborts.
const readSseStreamWith = async function* readSseStreamWithGen<T>(
  body: ReadableStream<Uint8Array>,
  parser: SseParser<T>,
  signal?: AbortSignal,
): AsyncIterable<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  // Cancel the reader on abort so the connection is released.
  const onAbort = (): void => {
    void reader.cancel();
  };
  signal?.addEventListener("abort", onAbort);
  try {
    for (;;) {
      // Each read waits for the one before it, so awaiting in the loop is intended.
      // oxlint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      // `stream: true` keeps multi-byte characters whole across reads.
      for (const item of parser.push(decoder.decode(value, { stream: true }))) {
        yield item;
      }
    }
    for (const item of parser.flush()) {
      yield item;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
};

// Yield each walkthrough chunk from a byte stream of events.
const readSseStream = (
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<WalkthroughChunk> => readSseStreamWith(body, createSseParser(), signal);

export { readSseStream, readSseStreamWith };
