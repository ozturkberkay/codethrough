import { parse } from "valibot";
import { describe, expect, it } from "vitest";
import { Summary } from "../../src/summary.js";

describe("Summary", () => {
  it("accepts a well-formed summary", () => {
    const value = parse(Summary, {
      problem: "Reviewers cannot keep up.",
      statusQuo: "Diffs are read top to bottom.",
      solution: "A guided walkthrough.",
      keyDecisions: ["Use Valibot", "Lift the engine"],
    });

    expect(value.solution).toBe("A guided walkthrough.");
    expect(value.keyDecisions).toHaveLength(2);
  });

  it("rejects a non-string key decision", () => {
    expect(() =>
      parse(Summary, {
        problem: "p",
        statusQuo: "s",
        solution: "x",
        keyDecisions: [1],
      }),
    ).toThrow();
  });

  it("rejects a missing field", () => {
    expect(() => parse(Summary, { problem: "p", statusQuo: "s", solution: "x" })).toThrow();
  });
});
