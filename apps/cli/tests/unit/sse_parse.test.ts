// Tests for the frontend event parser: an event split across pushes is rejoined,
// several events in one push all emit, a bad payload is dropped (not thrown), and
// the tail is flushed at the end. The same core builds the comment-change parser.

import type { CommentDelta, WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { createCommentDeltaParser, createSseParser, parseFrame } from "../../frontend/sse_parse.js";

const summaryChunk: WalkthroughChunk = {
  type: "summary",
  summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d"] },
};

const frameFor = (chunk: WalkthroughChunk): string => `data: ${JSON.stringify(chunk)}\n\n`;

describe("parseFrame", () => {
  it("parses a valid data frame into a chunk", () => {
    expect(parseFrame(`data: ${JSON.stringify(summaryChunk)}`)).toEqual(summaryChunk);
  });

  it("strips a single leading space after the colon", () => {
    expect(parseFrame(`data:${JSON.stringify(summaryChunk)}`)).toEqual(summaryChunk);
  });

  it("returns null for a frame with no data line", () => {
    expect(parseFrame(": a comment line")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseFrame("data: {not json")).toBeNull();
  });

  it("returns null for JSON that fails schema validation", () => {
    expect(parseFrame(`data: ${JSON.stringify({ type: "bogus" })}`)).toBeNull();
  });
});

describe("createSseParser", () => {
  it("emits a chunk once a full frame arrives", () => {
    const parser = createSseParser();
    expect(parser.push(frameFor(summaryChunk))).toEqual([summaryChunk]);
  });

  it("reassembles a frame split across two pushes", () => {
    const parser = createSseParser();
    const frame = frameFor(summaryChunk);
    const mid = Math.floor(frame.length / 2);
    expect(parser.push(frame.slice(0, mid))).toEqual([]);
    expect(parser.push(frame.slice(mid))).toEqual([summaryChunk]);
  });

  it("emits every frame when several arrive in one push", () => {
    const parser = createSseParser();
    const step: WalkthroughChunk = {
      type: "step",
      step: { order: 0, hunkId: "h0", lineRange: null, title: "t", explanation: "e" },
    };
    const done: WalkthroughChunk = { type: "done" };
    const combined = frameFor(summaryChunk) + frameFor(step) + frameFor(done);
    expect(parser.push(combined)).toEqual([summaryChunk, step, done]);
  });

  it("drops a malformed frame but keeps a valid neighbor", () => {
    const parser = createSseParser();
    const combined = `data: {bad\n\n${frameFor(summaryChunk)}`;
    expect(parser.push(combined)).toEqual([summaryChunk]);
  });

  it("flushes a trailing frame not terminated by a blank line", () => {
    const parser = createSseParser();
    expect(parser.push(`data: ${JSON.stringify(summaryChunk)}`)).toEqual([]);
    expect(parser.flush()).toEqual([summaryChunk]);
  });

  it("flushes nothing when the buffer is empty or whitespace", () => {
    const parser = createSseParser();
    expect(parser.flush()).toEqual([]);
    parser.push("   ");
    expect(parser.flush()).toEqual([]);
  });
});

describe("createCommentDeltaParser", () => {
  const delta: CommentDelta = {
    added: [
      {
        id: "c1",
        path: "a.ts",
        body: "hi",
        author: "octocat",
        line: 1,
        originalLine: 1,
        side: "RIGHT",
        startLine: null,
        subjectType: "line",
        inReplyToId: null,
        placement: {
          kind: "line",
          strategy: "exact",
          side: "additions",
          lineNumber: 1,
          spanStartLine: null,
        },
      },
    ],
    updated: [],
    removed: [],
  };

  it("emits a delta once a full frame arrives", () => {
    const parser = createCommentDeltaParser();
    expect(parser.push(`data: ${JSON.stringify(delta)}\n\n`)).toEqual([delta]);
  });

  it("drops a frame that fails the CommentDelta schema", () => {
    const parser = createCommentDeltaParser();
    // Missing the required fields, so it fails the schema and is dropped.
    expect(parser.push(`data: ${JSON.stringify({ added: "nope" })}\n\n`)).toEqual([]);
  });

  it("flushes a trailing delta frame with no blank line", () => {
    const parser = createCommentDeltaParser();
    expect(parser.push(`data: ${JSON.stringify(delta)}`)).toEqual([]);
    expect(parser.flush()).toEqual([delta]);
  });

  it("flushes nothing for a trailing invalid delta frame", () => {
    const parser = createCommentDeltaParser();
    parser.push("data: {bad");
    expect(parser.flush()).toEqual([]);
  });
});
