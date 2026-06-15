import { parse } from "valibot";
import { describe, expect, it } from "vitest";
import { Step } from "../../src/step.js";

describe("Step", () => {
  it("accepts a step with a null lineRange", () => {
    const value = parse(Step, {
      order: 1,
      hunkId: "h0",
      lineRange: null,
      title: "Add the loader",
      explanation: "It reads the diff once.",
    });

    expect(value.lineRange).toBeNull();
  });

  it("accepts a step with an integer lineRange array", () => {
    const value = parse(Step, {
      order: 2,
      hunkId: "h1",
      lineRange: [10, 14],
      title: "t",
      explanation: "e",
    });

    expect(value.lineRange).toEqual([10, 14]);
  });

  it("rejects a non-integer order", () => {
    expect(() =>
      parse(Step, { order: 1.5, hunkId: "h0", lineRange: null, title: "t", explanation: "e" }),
    ).toThrow();
  });

  it("rejects a non-integer inside lineRange", () => {
    expect(() =>
      parse(Step, { order: 1, hunkId: "h0", lineRange: [1.5], title: "t", explanation: "e" }),
    ).toThrow();
  });
});
