// Tests for the step validator and coveredHunkIds. The validator enforces what the
// schema cannot ("the line range is two numbers, in range, start <= end"). These
// cover the one hard drop rule (unknown hunk id), the bad-range fallback (kept but
// reset to the whole hunk), the sort-then-renumber, and that drops and adjustments
// carry a reason for the log. No I/O: the validator takes plain data.

import type { Step } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import type { HunkCatalog } from "../../src/hunk_catalog.js";
import { coveredHunkIds, validateSteps } from "../../src/walkthrough.js";

// Hunk h0 covers new-side lines 1..3, h1 covers 10..11. The validator reads only the
// new-side line numbers, so the rows and content are kept minimal.
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
    {
      id: "h1",
      file: "b.ts",
      status: "added",
      lines: [
        { line: 10, content: "ten" },
        { line: 11, content: "eleven" },
      ],
    },
  ],
  rows: [],
};

/** Short step builder; the defaults make one valid whole-hunk step. */
const step = (over: Partial<Step> = {}): Step => ({
  order: 1,
  hunkId: "h0",
  lineRange: null,
  title: "t",
  explanation: "e",
  ...over,
});

describe("validateSteps drop rules", () => {
  it("drops a step whose hunkId is not in the catalog, with a reason", () => {
    const result = validateSteps([step({ hunkId: "h99" })], catalog);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]!.step.hunkId).toBe("h99");
    expect(result.dropped[0]!.reason).toMatch(/unknown hunk id/i);
  });

  it("accepts a null lineRange (whole-hunk step)", () => {
    const result = validateSteps([step({ lineRange: null })], catalog);
    expect(result.valid).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    expect(result.valid[0]!.lineRange).toBeNull();
  });

  it("accepts a two-element lineRange inside the hunk's new-side range", () => {
    const result = validateSteps([step({ lineRange: [1, 3] })], catalog);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]!.lineRange).toEqual([1, 3]);
  });
});

describe("validateSteps lineRange fallback (kept, reset to whole-hunk)", () => {
  it("keeps a non-two-element lineRange, reset to null, with a reason", () => {
    const one = validateSteps([step({ lineRange: [1] })], catalog);
    const three = validateSteps([step({ lineRange: [1, 2, 3] })], catalog);
    expect(one.valid).toHaveLength(1);
    expect(one.valid[0]!.lineRange).toBeNull();
    expect(one.dropped).toHaveLength(0);
    expect(one.adjusted[0]!.reason).toMatch(/exactly two/i);
    expect(three.valid[0]!.lineRange).toBeNull();
    expect(three.adjusted[0]!.reason).toMatch(/exactly two/i);
  });

  it("keeps a reversed lineRange (start > end), reset to null", () => {
    const result = validateSteps([step({ lineRange: [3, 1] })], catalog);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]!.lineRange).toBeNull();
    expect(result.adjusted[0]!.reason).toMatch(/start <= end/i);
  });

  it("keeps an out-of-range lineRange, reset to null", () => {
    const below = validateSteps([step({ hunkId: "h1", lineRange: [9, 11] })], catalog);
    const above = validateSteps([step({ lineRange: [2, 4] })], catalog);
    expect(below.valid[0]!.lineRange).toBeNull();
    expect(below.adjusted[0]!.reason).toMatch(/outside/i);
    expect(above.valid[0]!.lineRange).toBeNull();
    expect(above.adjusted[0]!.reason).toMatch(/outside/i);
  });

  it("keeps a lineRange against a hunk with no new-side lines, reset to null", () => {
    // A hunk with only deletions has no new-side lines, so any range is out of range;
    // the step survives as a whole-hunk highlight.
    const emptyLines: HunkCatalog = {
      hunks: [{ id: "h0", file: "a.ts", status: "modified", lines: [] }],
      rows: [],
    };
    const result = validateSteps([step({ lineRange: [1, 2] })], emptyLines);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]!.lineRange).toBeNull();
    expect(result.adjusted[0]!.reason).toMatch(/no new-side lines/i);
  });
});

describe("validateSteps sort and re-index", () => {
  it("sorts survivors by order then re-indexes order to a contiguous 0..n-1", () => {
    const result = validateSteps(
      [
        step({ order: 30, hunkId: "h1", title: "third" }),
        step({ order: 10, hunkId: "h0", title: "first" }),
        step({ order: 20, hunkId: "h1", title: "second" }),
      ],
      catalog,
    );

    expect(result.valid.map((s) => s.title)).toEqual(["first", "second", "third"]);
    // The model's numbers (10/20/30) become 0, 1, 2, so the UI can use the position.
    expect(result.valid.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it("re-indexes around dropped steps so survivors stay contiguous", () => {
    const result = validateSteps(
      [
        step({ order: 1, hunkId: "h0", title: "keep-a" }),
        step({ order: 2, hunkId: "h99", title: "drop-me" }),
        step({ order: 3, hunkId: "h1", title: "keep-b" }),
      ],
      catalog,
    );

    expect(result.valid.map((s) => s.title)).toEqual(["keep-a", "keep-b"]);
    expect(result.valid.map((s) => s.order)).toEqual([0, 1]);
    expect(result.dropped).toHaveLength(1);
  });
});

describe("coveredHunkIds", () => {
  it("returns exactly the surviving steps' hunk ids", () => {
    const valid: Step[] = [
      step({ order: 0, hunkId: "h0" }),
      step({ order: 1, hunkId: "h1" }),
      // A duplicate id collapses in the Set.
      step({ order: 2, hunkId: "h0" }),
    ];
    expect(coveredHunkIds(valid)).toEqual(new Set(["h0", "h1"]));
  });

  it("is empty when there are no valid steps", () => {
    expect(coveredHunkIds([])).toEqual(new Set<string>());
  });
});
