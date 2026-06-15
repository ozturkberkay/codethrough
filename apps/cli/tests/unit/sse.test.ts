// Tests for the server event serializer: each chunk becomes one `data: <json>\n\n`
// event the frontend parser can split back out, and a comment change is framed the
// same way.

import type { CommentDelta, WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import {
  serializeChunk,
  serializeCommentDelta,
  serializeErrorFrame,
} from "../../src/server/sse.js";

describe("serializeChunk", () => {
  it("frames a summary chunk as one data line terminated by a blank line", () => {
    const chunk: WalkthroughChunk = {
      type: "summary",
      summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d"] },
    };
    const frame = serializeChunk(chunk);
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    // The payload round-trips through JSON.
    const json = frame.slice("data: ".length, -2);
    expect(JSON.parse(json)).toEqual(chunk);
    // Exactly one data frame (no embedded blank line splitting it).
    expect(frame.split("\n\n")).toHaveLength(2);
  });

  it("frames a step, usage, and done chunk", () => {
    const step: WalkthroughChunk = {
      type: "step",
      step: { order: 0, hunkId: "h0", lineRange: null, title: "t", explanation: "e" },
    };
    const usage: WalkthroughChunk = {
      type: "usage",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
    };
    const done: WalkthroughChunk = { type: "done" };
    for (const chunk of [step, usage, done]) {
      const frame = serializeChunk(chunk);
      expect(JSON.parse(frame.slice("data: ".length, -2))).toEqual(chunk);
    }
  });
});

describe("serializeErrorFrame", () => {
  it("frames a parse error chunk", () => {
    const frame = serializeErrorFrame("boom");
    expect(JSON.parse(frame.slice("data: ".length, -2))).toEqual({
      type: "error",
      kind: "parse",
      message: "boom",
    });
  });
});

describe("serializeCommentDelta", () => {
  it("frames a comments delta as one data line terminated by a blank line", () => {
    const delta: CommentDelta = { added: [], updated: [], removed: [] };
    const frame = serializeCommentDelta(delta);
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(frame.slice("data: ".length, -2))).toEqual(delta);
    expect(frame.split("\n\n")).toHaveLength(2);
  });
});
