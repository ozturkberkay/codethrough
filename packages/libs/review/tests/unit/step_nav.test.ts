import { describe, expect, it } from "vitest";
import type { DiffModel, Step } from "@codethrough/schema";
import {
  clampIndex,
  nextIndex,
  positionLabel,
  prevIndex,
  scrollTargetForStep,
} from "../../src/step_nav.js";

// The shared diff for these tests: greet.ts, math.ts, and a new grid.ts file.
// Their hunks are h0, h1, and h2 in that order.
const DIFF: DiffModel = {
  rawDiff: `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,4 @@
 const name = "world";
 export function greet() {
+  console.log("added line here");
   return \`hello \${name}\`;
 }
diff --git a/src/math.ts b/src/math.ts
index 3333333..4444444 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,4 +1,4 @@
 export function add(a: number, b: number) {
-  return a - b;
+  return a + b;
 }
 export const PI = 3.14;
diff --git a/src/grid.ts b/src/grid.ts
new file mode 100644
index 0000000..5555555
--- /dev/null
+++ b/src/grid.ts
@@ -0,0 +1,5 @@
+export const cell_1 = 1;
+export const cell_2 = 2;
+export const cell_3 = 3;
+export const cell_4 = 4;
+export const cell_5 = 5;
`,
  files: [
    { path: "src/greet.ts", oldPath: null, status: "modified" },
    { path: "src/math.ts", oldPath: null, status: "modified" },
    { path: "src/grid.ts", oldPath: null, status: "added" },
  ],
};

const step = (over: Partial<Step> & { hunkId: string }): Step => ({
  order: 0,
  lineRange: null,
  title: "t",
  explanation: "e",
  ...over,
});

describe("clampIndex", () => {
  it("returns -1 when there are no steps", () => {
    expect(clampIndex(0, 0)).toBe(-1);
    expect(clampIndex(3, 0)).toBe(-1);
  });

  it("clamps below zero up to zero and above the last down to the last", () => {
    expect(clampIndex(-5, 3)).toBe(0);
    expect(clampIndex(9, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
  });
});

describe("nextIndex / prevIndex", () => {
  it("advances without passing the last step", () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe(2);
  });

  it("retreats without passing the first step", () => {
    expect(prevIndex(2, 3)).toBe(1);
    expect(prevIndex(0, 3)).toBe(0);
  });

  it("advances correctly from a stale index after more steps arrived", () => {
    // The index was 0 when there was one step; now there are three.
    expect(nextIndex(0, 3)).toBe(1);
  });

  it("stays at -1 when there are no steps", () => {
    expect(nextIndex(-1, 0)).toBe(-1);
    expect(prevIndex(-1, 0)).toBe(-1);
  });
});

describe("positionLabel", () => {
  it("renders a 1-based i / n", () => {
    expect(positionLabel(0, 3)).toBe("1 / 3");
    expect(positionLabel(2, 3)).toBe("3 / 3");
  });

  it("renders 0 / 0 with no steps", () => {
    expect(positionLabel(-1, 0)).toBe("0 / 0");
  });
});

describe("scrollTargetForStep", () => {
  it("resolves a whole-hunk step to the hunk's first added line", () => {
    expect(scrollTargetForStep(step({ hunkId: "h0" }), DIFF)).toEqual({
      type: "line",
      id: "src/greet.ts",
      lineNumber: 1,
      side: "additions",
      align: "center",
    });
  });

  it("resolves the second hunk to its own file", () => {
    const target = scrollTargetForStep(step({ hunkId: "h1" }), DIFF);

    expect(target?.id).toBe("src/math.ts");
    expect(target?.side).toBe("additions");
  });

  it("pins to the line range start when one is given", () => {
    const target = scrollTargetForStep(step({ hunkId: "h2", lineRange: [3, 4] }), DIFF);

    expect(target).toEqual({
      type: "line",
      id: "src/grid.ts",
      lineNumber: 3,
      side: "additions",
      align: "center",
    });
  });

  it("clamps a range start that sits outside the hunk into the hunk", () => {
    const target = scrollTargetForStep(step({ hunkId: "h0", lineRange: [999] }), DIFF);

    // The file only has new lines 1 through 4, so 999 clamps to 4.
    expect(target?.lineNumber).toBe(4);
  });

  it("returns undefined for an unknown hunk id", () => {
    expect(scrollTargetForStep(step({ hunkId: "h99" }), DIFF)).toBeUndefined();
    expect(scrollTargetForStep(step({ hunkId: "not-a-hunk" }), DIFF)).toBeUndefined();
  });

  it("targets the deletions side for a pure-deletion hunk (no new-side lines)", () => {
    // A hunk that only removes lines has no new lines, so the target uses the old
    // side.
    const deletionDiff: DiffModel = {
      rawDiff: `diff --git a/src/drop.ts b/src/drop.ts
index 1111111..2222222 100644
--- a/src/drop.ts
+++ b/src/drop.ts
@@ -1,2 +0,0 @@
-export const gone_a = 1;
-export const gone_b = 2;
`,
      files: [{ path: "src/drop.ts", oldPath: null, status: "modified" }],
    };

    expect(scrollTargetForStep(step({ hunkId: "h0" }), deletionDiff)).toEqual({
      type: "line",
      id: "src/drop.ts",
      lineNumber: 1,
      side: "deletions",
      align: "center",
    });
  });
});
