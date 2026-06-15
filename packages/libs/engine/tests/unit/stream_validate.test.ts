// Tests for the per-step validator: the summary check, and the step rules (drop an
// unknown hunk, reset an out-of-range line range to null, number each step to its
// kept position, skip a broken or wrong-shaped piece). These are the rules
// composeStream applies to each piece the reader returns.

import type { Step } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import type { HunkCatalog } from "../../src/hunk_catalog.js";
import { createStepValidator, parseSummary } from "../../src/stream_validate.js";

// Hunk h0 covers new-side lines 1..3, h1 covers 10..11.
const catalog: HunkCatalog = {
  hunks: [
    {
      id: "h0",
      file: "a.ts",
      status: "modified",
      lines: [
        { line: 1, content: "one" },
        { line: 2, content: "two" },
        { line: 3, content: "three" },
      ],
    },
    { id: "h1", file: "b.ts", status: "added", lines: [{ line: 10, content: "ten" }] },
  ],
  rows: [],
};

// A valid step's JSON, with fields you can override.
const stepJson = (over: Partial<Step> = {}): string =>
  JSON.stringify({
    order: 99,
    hunkId: "h0",
    lineRange: null,
    title: "t",
    explanation: "e",
    ...over,
  });

describe("parseSummary", () => {
  it("returns the summary for a valid raw object", () => {
    const raw = JSON.stringify({
      problem: "p",
      statusQuo: "s",
      solution: "sol",
      keyDecisions: ["d"],
    });
    expect(parseSummary(raw)).toEqual({
      problem: "p",
      statusQuo: "s",
      solution: "sol",
      keyDecisions: ["d"],
    });
  });

  it("returns null when a required field is missing (valibot gate)", () => {
    expect(parseSummary(JSON.stringify({ problem: "p" }))).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(parseSummary(JSON.stringify(["not", "a", "summary"]))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseSummary("{ not json")).toBeNull();
  });
});

describe("createStepValidator: re-index on arrival", () => {
  it("stamps order to the survivor position regardless of the model's order", () => {
    const validator = createStepValidator(catalog);
    const a = validator.next(stepJson({ order: 50, hunkId: "h0" }));
    const b = validator.next(stepJson({ order: 7, hunkId: "h1" }));
    expect(a).toEqual({
      kind: "step",
      step: { order: 0, hunkId: "h0", lineRange: null, title: "t", explanation: "e" },
    });
    expect(b.kind === "step" && b.step.order).toBe(1);
  });

  it("does NOT advance the survivor index for a dropped step", () => {
    const validator = createStepValidator(catalog);
    const kept1 = validator.next(stepJson({ hunkId: "h0" }));
    const dropped = validator.next(stepJson({ hunkId: "h99" }));
    const kept2 = validator.next(stepJson({ hunkId: "h1" }));
    expect(kept1.kind === "step" && kept1.step.order).toBe(0);
    expect(dropped).toEqual({ kind: "skip", reason: 'unknown hunk id "h99".' });
    // The dropped step did not count, so the next kept step is 1, not 2.
    expect(kept2.kind === "step" && kept2.step.order).toBe(1);
  });
});

describe("createStepValidator: catalog rules", () => {
  it("drops a step whose hunkId is not in the catalog", () => {
    const validator = createStepValidator(catalog);
    expect(validator.next(stepJson({ hunkId: "nope" }))).toEqual({
      kind: "skip",
      reason: 'unknown hunk id "nope".',
    });
  });

  it("keeps an in-range two-element lineRange as-is", () => {
    const validator = createStepValidator(catalog);
    const out = validator.next(stepJson({ hunkId: "h0", lineRange: [1, 3] }));
    expect(out.kind === "step" && out.step.lineRange).toEqual([1, 3]);
  });

  it("resets an out-of-range lineRange to null (kept as whole-hunk)", () => {
    const validator = createStepValidator(catalog);
    const out = validator.next(stepJson({ hunkId: "h0", lineRange: [2, 9] }));
    expect(out.kind).toBe("step");
    expect(out.kind === "step" && out.step.lineRange).toBeNull();
  });

  it("resets a non-two-element lineRange to null", () => {
    const validator = createStepValidator(catalog);
    const out = validator.next(stepJson({ hunkId: "h0", lineRange: [1] }));
    expect(out.kind === "step" && out.step.lineRange).toBeNull();
  });
});

describe("createStepValidator: malformed / invalid shape is skipped", () => {
  it("skips a step that does not match the Step schema", () => {
    const validator = createStepValidator(catalog);
    // Missing title/explanation, wrong types.
    const out = validator.next(JSON.stringify({ order: 1, hunkId: "h0" }));
    expect(out).toEqual({ kind: "skip", reason: "step did not match the Step schema." });
  });

  it("skips malformed JSON without throwing", () => {
    const validator = createStepValidator(catalog);
    expect(validator.next("{ broken")).toEqual({
      kind: "skip",
      reason: "step did not match the Step schema.",
    });
  });

  it("does not advance the survivor index for a malformed step", () => {
    const validator = createStepValidator(catalog);
    validator.next("{ broken");
    const kept = validator.next(stepJson({ hunkId: "h0" }));
    expect(kept.kind === "step" && kept.step.order).toBe(0);
  });
});
