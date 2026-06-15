import { parse } from "valibot";
import { describe, expect, it } from "vitest";
import { Walkthrough } from "../../src/walkthrough.js";

const summary = {
  problem: "p",
  statusQuo: "s",
  solution: "x",
  keyDecisions: ["d"],
};

describe("Walkthrough", () => {
  it("accepts a summary plus ordered steps", () => {
    const value = parse(Walkthrough, {
      summary,
      steps: [{ order: 1, hunkId: "h0", lineRange: null, title: "t", explanation: "e" }],
    });

    expect(value.steps).toHaveLength(1);
    expect(value.summary.solution).toBe("x");
  });

  it("rejects a missing summary", () => {
    expect(() => parse(Walkthrough, { steps: [] })).toThrow();
  });

  it("rejects a malformed step", () => {
    expect(() => parse(Walkthrough, { summary, steps: [{ order: 1 }] })).toThrow();
  });
});
