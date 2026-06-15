// Turn one stream item into a `data: <json>\n\n` event. We send only data lines
// so the frontend parser stays simple. Each item is one line of JSON, which works
// because JSON.stringify never adds a newline for these shapes.

import type { CommentDelta, WalkthroughChunk } from "@codethrough/schema";

// The blank line that ends one event.
const FRAME_TERMINATOR = "\n\n";

// Turn any value into one complete event: a single data line plus a blank line.
const serializeFrame = (value: unknown): string =>
  `data: ${JSON.stringify(value)}${FRAME_TERMINATOR}`;

// Frame one walkthrough chunk.
const serializeChunk = (chunk: WalkthroughChunk): string => serializeFrame(chunk);

// Frame an error event for a failure while streaming (not an engine error chunk),
// so the client gets a clear final frame.
const serializeErrorFrame = (message: string): string =>
  serializeChunk({ type: "error", kind: "parse", message });

// Frame one comment change for the live stream.
const serializeCommentDelta = (delta: CommentDelta): string => serializeFrame(delta);

export { serializeChunk, serializeCommentDelta, serializeErrorFrame, serializeFrame };
