// The fake review data and walkthrough the e2e server serves: a real two-file diff
// so the diff renders, a couple of comments, and a walkthrough that yields a
// summary, two steps, usage, and done. Drives the full <Review> UI with no GitHub
// or Anthropic call.

import type { Comment, ReviewContext, ReviewData, WalkthroughChunk } from "@codethrough/schema";

// A two-file diff with clear added lines the e2e can check rendered.
const E2E_DIFF = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,4 @@
 export const greet = (name: string): string => {
+  console.log("debug greet line");
   return \`Hello, \${name}\`;
 };
diff --git a/src/math.ts b/src/math.ts
index 3333333..4444444 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,3 +1,3 @@
 export const add = (a: number, b: number): number => {
-  return a - b;
+  return a + b;
 };
`;

const E2E_COMMENTS: Comment[] = [
  {
    id: "c-line",
    path: "src/greet.ts",
    body: "Was this debug log meant to ship?",
    author: "octocat",
    line: 2,
    originalLine: 2,
    side: "RIGHT",
    startLine: null,
    subjectType: "line",
    inReplyToId: null,
    placement: {
      kind: "line",
      strategy: "exact",
      side: "additions",
      lineNumber: 2,
      spanStartLine: null,
    },
  },
  {
    id: "c-note",
    path: "src/math.ts",
    body: "A general note that has no current line.",
    author: "maintainer",
    line: null,
    originalLine: null,
    side: "RIGHT",
    startLine: null,
    subjectType: "file",
    inReplyToId: null,
    placement: { kind: "general", strategy: "file-note" },
  },
];

const E2E_REVIEW: ReviewData = {
  meta: {
    title: "Fix the adder and tidy greet",
    body: "Swap the operator and remove a stray log.",
    repoOwner: "octo",
    repoName: "demo",
    number: 7,
    baseRef: "main",
    headRef: "fix-adder",
    author: "octocat",
    url: "https://github.com/octo/demo/pull/7",
  },
  diff: {
    rawDiff: E2E_DIFF,
    files: [
      { path: "src/greet.ts", oldPath: null, status: "modified" },
      { path: "src/math.ts", oldPath: null, status: "modified" },
    ],
  },
  comments: E2E_COMMENTS,
};

// A comment the poller "finds" after the page loads, which the e2e checks appears
// without a reload. General (not line) so it shows up regardless of diff timing.
const E2E_LIVE_COMMENT: Comment = {
  id: "c-live",
  path: "src/math.ts",
  body: "A live comment that arrived after load.",
  author: "reviewer",
  line: null,
  originalLine: null,
  side: "RIGHT",
  startLine: null,
  subjectType: "file",
  inReplyToId: null,
  placement: { kind: "general", strategy: "file-note" },
};

const E2E_CONTEXT: ReviewContext = {
  sessionId: "e2e-session",
  mode: "pr",
  viewer: { login: "octocat" },
  repo: { owner: "octo", name: "demo" },
};

const E2E_CHUNKS: WalkthroughChunk[] = [
  {
    type: "summary",
    summary: {
      problem: "The adder subtracted instead of adding.",
      statusQuo: "add(a, b) returned a - b and greet logged on every call.",
      solution: "Swap the operator and drop the stray log.",
      keyDecisions: ["Keep the public signatures", "Remove the debug log"],
    },
  },
  {
    type: "step",
    step: {
      order: 0,
      hunkId: "h0",
      lineRange: [2],
      title: "Remove the stray log in greet",
      explanation: "The added console.log was debug noise and is dropped.",
    },
  },
  {
    type: "step",
    step: {
      order: 1,
      hunkId: "h1",
      lineRange: null,
      title: "Fix the adder",
      explanation: "math.ts now adds instead of subtracting.",
    },
  },
  { type: "usage", inputTokens: 1_200, outputTokens: 300, costUsd: 0.018 },
  { type: "done" },
];

export { E2E_CHUNKS, E2E_COMMENTS, E2E_CONTEXT, E2E_DIFF, E2E_LIVE_COMMENT, E2E_REVIEW };
