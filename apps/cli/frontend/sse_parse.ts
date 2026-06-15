// Parses stream events, for any payload type. The frontend reads a stream with
// fetch (not EventSource, which cannot send our token), turns the bytes into text,
// and feeds the text here. This keeps a buffer of partial events across reads,
// splits on the blank line, pulls out each data line, and checks it against a
// schema so a bad event is dropped instead of crashing the reader.
//
// Two streams use it: the walkthrough and the live comments. The splitting is
// shared; only the schema differs, so each stream gets its own typed parser.
//
// It keeps a buffer but does no I/O, so it is tested with a fake list of text
// pieces, including an event split across two of them.

import { type GenericSchema, type InferOutput, safeParse } from "valibot";
import { CommentDelta, WalkthroughChunk } from "@codethrough/schema";

// The blank line that ends one event.
const FRAME_TERMINATOR = "\n\n";
const DATA_PREFIX = "data:";

// A marker for "not valid JSON", so we can tell a parse failure from a real
// undefined value.
const PARSE_FAILED = Symbol("parse_failed");

// Parse JSON, returning the marker on failure instead of throwing.
const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return PARSE_FAILED;
  }
};

// Parse one event's text into a value, or null when it has no data line or fails
// the schema. An event may hold other lines too; we read only the data lines.
const parseFrameWith = <S extends GenericSchema>(
  frame: string,
  schema: S,
): InferOutput<S> | null => {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith(DATA_PREFIX))
    .map((line) => line.slice(DATA_PREFIX.length).replace(/^ /, ""));
  if (dataLines.length === 0) {
    return null;
  }
  const json = tryParseJson(dataLines.join("\n"));
  if (json === PARSE_FAILED) {
    return null;
  }
  const result = safeParse(schema, json);
  return result.success ? result.output : null;
};

// The parser: push text as it arrives (returns the values it completed), and
// flush any leftover event when the stream ends.
interface SseParser<T> {
  push: (text: string) => T[];
  flush: () => T[];
}

// Build a parser for one schema. Keeps partial events across pushes, splits on the
// blank line, and checks each event against the schema.
const createSchemaSseParser = <S extends GenericSchema>(schema: S): SseParser<InferOutput<S>> => {
  let buffer = "";

  const push = (text: string): InferOutput<S>[] => {
    buffer += text;
    const values: InferOutput<S>[] = [];
    let terminator = buffer.indexOf(FRAME_TERMINATOR);
    while (terminator !== -1) {
      const frame = buffer.slice(0, terminator);
      buffer = buffer.slice(terminator + FRAME_TERMINATOR.length);
      const value = parseFrameWith(frame, schema);
      if (value !== null) {
        values.push(value);
      }
      terminator = buffer.indexOf(FRAME_TERMINATOR);
    }
    return values;
  };

  // At stream end, parse any leftover (a last event with no trailing blank line).
  const flush = (): InferOutput<S>[] => {
    const remainder = buffer.trim();
    buffer = "";
    if (remainder === "") {
      return [];
    }
    const value = parseFrameWith(remainder, schema);
    return value === null ? [] : [value];
  };

  return { push, flush };
};

// The walkthrough parser.
const createSseParser = (): SseParser<WalkthroughChunk> => createSchemaSseParser(WalkthroughChunk);

// Parse one walkthrough event (used by the parser tests directly).
const parseFrame = (frame: string): WalkthroughChunk | null =>
  parseFrameWith(frame, WalkthroughChunk);

// The live-comments parser.
const createCommentDeltaParser = (): SseParser<CommentDelta> => createSchemaSseParser(CommentDelta);

export { createCommentDeltaParser, createSchemaSseParser, createSseParser, parseFrame };
export type { SseParser };
