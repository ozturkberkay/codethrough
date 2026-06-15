import { describe, expect, it } from "vitest";
import type { Comment, DiffModel, Step } from "@codethrough/schema";
import {
  lineCommentAnnotations,
  resolveStepAnchor,
  stepAnnotations,
  toCodeViewItems,
} from "../../src/annotations.js";

// The shared diff for these tests: greet.ts and math.ts, each with new lines 1
// through 4.
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

const linePlace = {
  kind: "line",
  strategy: "exact",
  side: "additions",
  lineNumber: 2,
  spanStartLine: null,
} as const;

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

const step = (over: Partial<Step> & { hunkId: string }): Step => ({
  order: 0,
  lineRange: null,
  title: "t",
  explanation: "e",
  ...over,
});

describe("lineCommentAnnotations", () => {
  it("carries the author and threaded replies onto a line comment", () => {
    const replies = [
      comment({ id: "r1", author: "reviewer", body: "agreed", placement: linePlace }),
    ];
    const result = lineCommentAnnotations(
      [comment({ id: "root", placement: linePlace })],
      new Map([["root", replies]]),
    );

    expect(result).toEqual([
      {
        id: "root",
        path: "src/math.ts",
        side: "additions",
        lineNumber: 2,
        kind: "comment",
        label: "Looks off.",
        author: "octocat",
        replies,
      },
    ]);
  });

  it("defaults to no replies when the parent has none", () => {
    const result = lineCommentAnnotations(
      [comment({ id: "root", placement: linePlace })],
      new Map(),
    );

    expect(result[0]?.replies).toEqual([]);
  });

  it("skips general comments", () => {
    const result = lineCommentAnnotations(
      [comment({ id: "gone", placement: { kind: "general", strategy: "outdated-unplaceable" } })],
      new Map(),
    );

    expect(result).toEqual([]);
  });
});

describe("stepAnnotations / resolveStepAnchor", () => {
  it("anchors each step to its hunk's first changed line with a step-<i> id", () => {
    const result = stepAnnotations(
      [step({ hunkId: "h0", title: "greet" }), step({ hunkId: "h1", title: "math" })],
      DIFF,
    );

    expect(result).toEqual([
      {
        id: "step-0",
        path: "src/greet.ts",
        side: "additions",
        lineNumber: 1,
        kind: "step",
        label: "greet",
      },
      {
        id: "step-1",
        path: "src/math.ts",
        side: "additions",
        lineNumber: 1,
        kind: "step",
        label: "math",
      },
    ]);
  });

  it("drops a step whose hunk id does not resolve", () => {
    const result = stepAnnotations([step({ hunkId: "h99" })], DIFF);

    expect(result).toEqual([]);
  });

  it("pins to the line range start, clamped into the hunk", () => {
    const anchor = resolveStepAnchor(step({ hunkId: "h0", lineRange: [3] }), DIFF);

    expect(anchor).toEqual({ path: "src/greet.ts", side: "additions", lineNumber: 3 });
  });

  it("returns undefined for an unresolved hunk id", () => {
    expect(resolveStepAnchor(step({ hunkId: "nope" }), DIFF)).toBeUndefined();
  });
});

describe("toCodeViewItems comment metadata", () => {
  it("carries author and replies through to the annotation metadata", () => {
    const reply = comment({ id: "r1", author: "reviewer", body: "agreed", placement: linePlace });
    const items = toCodeViewItems(DIFF, [
      {
        id: "c1",
        path: "src/math.ts",
        side: "additions",
        lineNumber: 2,
        kind: "comment",
        label: "x",
        author: "octocat",
        replies: [reply],
      },
    ]);

    const meta = items.find((item) => item.id === "src/math.ts")?.annotations?.[0]?.metadata;
    expect(meta?.author).toBe("octocat");
    expect(meta?.replies).toEqual([reply]);
  });
});
