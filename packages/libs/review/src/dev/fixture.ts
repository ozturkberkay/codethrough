// A small multi-file diff and a few annotations to drive the end-to-end tests.
// grid.ts is a tall new file so the diff is taller than the view and scrolling has
// somewhere to go.
import type { DiffModel } from "@codethrough/schema";
import type { ReviewAnnotation } from "../annotations.js";

// How many lines grid.ts has. Tall enough that its last line is below the view.
const GRID_LINES = 40;

// Build grid.ts as a new file where every line is added.
const gridLines = Array.from(
  { length: GRID_LINES },
  (_unused, index) => `+export const cell_${index + 1} = ${index + 1};`,
).join("\n");

const RAW_DIFF = `diff --git a/src/greet.ts b/src/greet.ts
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
@@ -0,0 +1,${GRID_LINES} @@
${gridLines}
`;

export const FIXTURE_DIFF: DiffModel = {
  rawDiff: RAW_DIFF,
  files: [
    { path: "src/greet.ts", oldPath: null, status: "modified" },
    { path: "src/math.ts", oldPath: null, status: "modified" },
    { path: "src/grid.ts", oldPath: null, status: "added" },
  ],
};

// A step on the added line in greet.ts, a comment near the bottom of grid.ts (so
// activating it scrolls), and a comment on a line the diff does not show (which
// should be moved to the side list).
export const FIXTURE_ANNOTATIONS: ReviewAnnotation[] = [
  {
    id: "step-1",
    path: "src/greet.ts",
    side: "additions",
    lineNumber: 3,
    kind: "step",
    label: "Step 1: this line was added",
  },
  {
    id: "comment-1",
    path: "src/grid.ts",
    side: "additions",
    lineNumber: GRID_LINES,
    kind: "comment",
    label: "Last cell in the grid.",
  },
  {
    id: "comment-2-out-of-range",
    path: "src/math.ts",
    side: "additions",
    lineNumber: 999,
    kind: "comment",
    label: "Outdated comment on a line that no longer exists",
  },
];
