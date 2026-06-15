// A small shared fixture for the server-side tests: a minimal review (a one-file
// diff plus one comment), a context, and the walkthrough chunks a fake engine
// yields. Shared so the unit and integration tests agree on the data.

import type { Comment, ReviewContext, ReviewData, WalkthroughChunk } from "@codethrough/schema";

import type { ConfigLoader } from "../../src/run/resolve_run_config.js";

// A test config loader that finds no file, so the resolver uses flags, env, and
// defaults only. Returning undefined is the point here, so the rule is off.
// oxlint-disable-next-line no-useless-undefined
const noConfigLoader: ConfigLoader = () => undefined;

// Fake secrets the server holds but must never send out. The leak test scans every
// response for these exact strings.
const FAKE_ANTHROPIC_KEY = "sk-ant-FAKE-leak-canary-0000";
const FAKE_GITHUB_TOKEN = "gho_FAKEleakcanary0000";

const FIXTURE_DIFF = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,4 @@
 export const greet = (name: string): string => {
+  console.log("debug");
   return \`Hello, \${name}\`;
 };
`;

const FIXTURE_COMMENT: Comment = {
  id: "c1",
  path: "src/greet.ts",
  body: "Was this console.log meant to ship?",
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
};

const FIXTURE_REVIEW: ReviewData = {
  meta: {
    title: "Tidy greet",
    body: "Remove a stray log.",
    repoOwner: "octo",
    repoName: "demo",
    number: 7,
    baseRef: "main",
    headRef: "tidy-greet",
    author: "octocat",
    url: "https://github.com/octo/demo/pull/7",
  },
  diff: {
    rawDiff: FIXTURE_DIFF,
    files: [{ path: "src/greet.ts", oldPath: null, status: "modified" }],
  },
  comments: [FIXTURE_COMMENT],
};

const FIXTURE_CONTEXT: ReviewContext = {
  sessionId: "test-session",
  mode: "pr",
  viewer: { login: "octocat" },
  repo: { owner: "octo", name: "demo" },
};

const FIXTURE_CHUNKS: WalkthroughChunk[] = [
  {
    type: "summary",
    summary: {
      problem: "A stray log shipped.",
      statusQuo: "greet logged on every call.",
      solution: "Drop the debug log.",
      keyDecisions: ["Keep the public signature"],
    },
  },
  {
    type: "step",
    step: {
      order: 0,
      hunkId: "h0",
      lineRange: [2],
      title: "Remove the stray log",
      explanation: "The console.log was debug noise.",
    },
  },
  { type: "usage", inputTokens: 0, outputTokens: 0, costUsd: 0 },
  { type: "done" },
];

export {
  FAKE_ANTHROPIC_KEY,
  FAKE_GITHUB_TOKEN,
  FIXTURE_CHUNKS,
  FIXTURE_COMMENT,
  FIXTURE_CONTEXT,
  FIXTURE_DIFF,
  FIXTURE_REVIEW,
  noConfigLoader,
};
