import { parse } from "valibot";
import { describe, expect, it } from "vitest";
import { WalkthroughChunk } from "../../src/chunk.js";

const summary = { problem: "p", statusQuo: "s", solution: "x", keyDecisions: ["d"] };
const step = { order: 1, hunkId: "h0", lineRange: null, title: "t", explanation: "e" };

describe("WalkthroughChunk", () => {
  it("accepts a summary chunk", () => {
    const value = parse(WalkthroughChunk, { type: "summary", summary });

    expect(value.type === "summary" && value.summary.solution).toBe("x");
  });

  it("accepts a step chunk", () => {
    const value = parse(WalkthroughChunk, { type: "step", step });

    expect(value.type === "step" && value.step.hunkId).toBe("h0");
  });

  it("accepts an error chunk", () => {
    const value = parse(WalkthroughChunk, {
      type: "error",
      kind: "max_tokens",
      message: "Hit the cap.",
    });

    expect(value.type === "error" && value.kind).toBe("max_tokens");
  });

  it("accepts a usage chunk", () => {
    const value = parse(WalkthroughChunk, {
      type: "usage",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
    });

    expect(value.type === "usage" && value.costUsd).toBe(0.01);
  });

  it("accepts a done chunk", () => {
    const value = parse(WalkthroughChunk, { type: "done" });

    expect(value.type).toBe("done");
  });

  it("rejects an unknown chunk type", () => {
    expect(() => parse(WalkthroughChunk, { type: "heartbeat" })).toThrow();
  });

  it("rejects an error chunk with a bad kind", () => {
    expect(() =>
      parse(WalkthroughChunk, { type: "error", kind: "timeout", message: "m" }),
    ).toThrow();
  });

  it("rejects an error chunk whose message exceeds the size bound", () => {
    const tooLong = "x".repeat(8_193);
    expect(() =>
      parse(WalkthroughChunk, { type: "error", kind: "parse", message: tooLong }),
    ).toThrow();
  });

  it("accepts an error chunk whose message is at the size bound", () => {
    const atMax = "x".repeat(8_192);
    const value = parse(WalkthroughChunk, { type: "error", kind: "parse", message: atMax });
    expect(value.type === "error" && value.message).toHaveLength(8_192);
  });
});
