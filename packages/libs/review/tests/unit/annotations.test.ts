import { describe, expect, it } from "vitest";
import type { Comment, DiffModel } from "@codethrough/schema";
import {
  commentAnnotations,
  partitionAnnotations,
  type ReviewAnnotation,
  scrollTargetFor,
  scrollTargetForStep,
  toCodeViewItems,
} from "../../src/annotations.js";

// The shared diff for these tests: greet.ts and math.ts, each with both new and
// old lines.
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
`,
  files: [
    { path: "src/greet.ts", oldPath: null, status: "modified" },
    { path: "src/math.ts", oldPath: null, status: "modified" },
  ],
};

const annotation = (over: Partial<ReviewAnnotation>): ReviewAnnotation => ({
  id: "a",
  path: "src/math.ts",
  side: "additions",
  lineNumber: 2,
  kind: "comment",
  label: "x",
  ...over,
});

const comment = (over: Partial<Comment> & { placement: Comment["placement"] }): Comment => ({
  id: "c1",
  path: "src/math.ts",
  body: "Looks off.",
  author: "octocat",
  line: 2,
  originalLine: 2,
  side: "RIGHT",
  startLine: null,
  subjectType: "line",
  inReplyToId: null,
  ...over,
});

const linePlace = {
  kind: "line",
  strategy: "exact",
  side: "additions",
  lineNumber: 2,
  spanStartLine: null,
} as const;

describe("commentAnnotations", () => {
  it("maps a line-placed comment, carrying side + lineNumber from the placement", () => {
    const result = commentAnnotations([comment({ placement: linePlace })]);

    expect(result).toEqual([
      {
        id: "c1",
        path: "src/math.ts",
        side: "additions",
        lineNumber: 2,
        kind: "comment",
        label: "Looks off.",
      },
    ]);
  });

  it("carries a deletions-side placement through", () => {
    const result = commentAnnotations([
      comment({
        side: "LEFT",
        placement: {
          kind: "line",
          strategy: "anchored-deletions",
          side: "deletions",
          lineNumber: 3,
          spanStartLine: null,
        },
      }),
    ]);

    expect(result[0]?.side).toBe("deletions");
    expect(result[0]?.lineNumber).toBe(3);
  });

  it("keeps line comments and drops general comments (file-level / unplaceable)", () => {
    const result = commentAnnotations([
      comment({ id: "line", placement: linePlace }),
      comment({
        id: "file",
        line: null,
        subjectType: "file",
        placement: { kind: "general", strategy: "file-note" },
      }),
      comment({ id: "gone", placement: { kind: "general", strategy: "outdated-unplaceable" } }),
    ]);

    expect(result.map((item) => item.id)).toEqual(["line"]);
  });

  it("returns an empty array for no comments", () => {
    expect(commentAnnotations([])).toEqual([]);
  });
});

describe("toCodeViewItems", () => {
  const annotations = [
    annotation({ id: "step-1", path: "src/greet.ts", lineNumber: 3, kind: "step", label: "added" }),
    annotation({ id: "comment-1", path: "src/math.ts", lineNumber: 2, label: "note" }),
  ];

  it("builds one diff item per file in diff order", () => {
    const items = toCodeViewItems(DIFF, annotations);

    expect(items.map((item) => item.id)).toEqual(["src/greet.ts", "src/math.ts"]);
    expect(items.every((item) => item.type === "diff")).toBe(true);
  });

  it("attaches each annotation to its own file as a DiffLineAnnotation", () => {
    const items = toCodeViewItems(DIFF, annotations);

    expect(items.find((item) => item.id === "src/greet.ts")?.annotations).toEqual([
      {
        side: "additions",
        lineNumber: 3,
        metadata: { id: "step-1", kind: "step", label: "added" },
      },
    ]);
    expect(items.find((item) => item.id === "src/math.ts")?.annotations).toEqual([
      {
        side: "additions",
        lineNumber: 2,
        metadata: { id: "comment-1", kind: "comment", label: "note" },
      },
    ]);
  });

  it("groups multiple annotations on the same file together", () => {
    const items = toCodeViewItems(DIFF, [
      ...annotations,
      annotation({
        id: "step-2",
        path: "src/greet.ts",
        side: "deletions",
        lineNumber: 1,
        kind: "step",
      }),
    ]);

    const greet = items.find((item) => item.id === "src/greet.ts");
    expect(greet?.annotations?.map((item) => item.metadata?.id)).toEqual(["step-1", "step-2"]);
  });

  it("gives files with no annotations an empty array", () => {
    const items = toCodeViewItems(DIFF, []);

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.annotations?.length === 0)).toBe(true);
  });
});

describe("scrollTargetFor / scrollTargetForStep", () => {
  it("builds a centered line scroll target, shared by the step variant", () => {
    const target = scrollTargetFor(annotation({ id: "step-1", kind: "step" }));

    expect(target).toEqual({
      type: "line",
      id: "src/math.ts",
      lineNumber: 2,
      side: "additions",
      align: "center",
    });
    expect(scrollTargetForStep(annotation({ id: "step-1", kind: "step" }))).toEqual(target);
  });
});

describe("partitionAnnotations", () => {
  it("marks in-range addition and deletion-side context lines placeable", () => {
    const { placeable, unplaceable } = partitionAnnotations(DIFF, [
      annotation({ id: "add", lineNumber: 2 }),
      // Line 1 on greet.ts's old side is a context line the diff shows.
      annotation({ id: "ctx", path: "src/greet.ts", side: "deletions", lineNumber: 1 }),
    ]);

    expect(placeable.map((item) => item.id)).toEqual(["add", "ctx"]);
    expect(unplaceable).toEqual([]);
  });

  it("marks an out-of-range line and an unknown-file line unplaceable", () => {
    const { placeable, unplaceable } = partitionAnnotations(DIFF, [
      annotation({ id: "gone", lineNumber: 999 }),
      annotation({ id: "ghost", path: "src/missing.ts", lineNumber: 1 }),
    ]);

    expect(placeable).toEqual([]);
    expect(unplaceable.map((item) => item.id)).toEqual(["gone", "ghost"]);
  });

  it("splits a mixed list into placeable and unplaceable", () => {
    const { placeable, unplaceable } = partitionAnnotations(DIFF, [
      annotation({ id: "ok", path: "src/greet.ts", side: "additions", lineNumber: 3 }),
      annotation({ id: "gone", path: "src/greet.ts", side: "additions", lineNumber: 99 }),
    ]);

    expect(placeable.map((item) => item.id)).toEqual(["ok"]);
    expect(unplaceable.map((item) => item.id)).toEqual(["gone"]);
  });
});
