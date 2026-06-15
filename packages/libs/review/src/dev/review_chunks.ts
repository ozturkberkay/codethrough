// Fake walkthrough streams for the test harness. The default one is a full,
// successful walkthrough; the error one fails partway through.
import type { WalkthroughChunk } from "@codethrough/schema";

// The greet.ts line the first step points at (the added console.log).
const GREET_LOG_LINE = 3;

// A full walkthrough: summary, two steps, then usage and done. The second step is
// in grid.ts, which is tall, so moving to it scrolls the diff.
const FIXTURE_CHUNKS: WalkthroughChunk[] = [
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
      lineRange: [GREET_LOG_LINE],
      title: "Remove the stray log in greet",
      explanation: "The added console.log was debug noise and is dropped.",
    },
  },
  {
    type: "step",
    step: {
      order: 1,
      hunkId: "h2",
      lineRange: null,
      title: "Seed the grid",
      explanation: "grid.ts defines the initial cells the adder operates on.",
    },
  },
  { type: "usage", inputTokens: 1_200, outputTokens: 300, costUsd: 0.018 },
  { type: "done" },
];

// Yields the full walkthrough one chunk at a time.
const fixtureStream = async function* fixtureStreamGen(): AsyncIterable<WalkthroughChunk> {
  for (const chunk of FIXTURE_CHUNKS) {
    yield chunk;
  }
};

// A failing walkthrough: the summary arrives, then it hits the token limit.
// Nothing comes after the error.
const ERROR_CHUNKS: WalkthroughChunk[] = [
  {
    type: "summary",
    summary: {
      problem: "The adder subtracted instead of adding.",
      statusQuo: "add(a, b) returned a - b.",
      solution: "Swap the operator.",
      keyDecisions: ["Keep the public signatures"],
    },
  },
  {
    type: "error",
    kind: "max_tokens",
    message: "compose stopped without a usable walkthrough: max_tokens",
  },
];

const errorStream = async function* errorStreamGen(): AsyncIterable<WalkthroughChunk> {
  for (const chunk of ERROR_CHUNKS) {
    yield chunk;
  }
};

export { errorStream, fixtureStream };
