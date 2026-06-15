import { describe, expect, it } from "vitest";
import type {
  Comment,
  CommentDraft,
  ReviewContext,
  ReviewData,
  ReviewDataSource,
  Step,
  Summary,
  WalkthroughChunk,
} from "@codethrough/schema";
import {
  consumeWalkthrough,
  initialWalkthroughState,
  reduceWalkthrough,
  type WalkthroughState,
} from "../../src/walkthrough_stream.js";

const summary: Summary = {
  problem: "p",
  statusQuo: "s",
  solution: "sol",
  keyDecisions: ["a"],
};

// A minimal review the fake source returns. The tests here only use the stream.
const EMPTY_REVIEW: ReviewData = {
  meta: {
    title: "t",
    body: "b",
    repoOwner: null,
    repoName: null,
    number: null,
    baseRef: "main",
    headRef: "head",
    author: null,
    url: null,
  },
  diff: { rawDiff: "", files: [] },
  comments: [],
};

const step = (order: number, title: string): Step => ({
  order,
  hunkId: `h${order}`,
  lineRange: null,
  title,
  explanation: `explain ${title}`,
});

const reduceAll = (chunks: WalkthroughChunk[]): WalkthroughState =>
  chunks.reduce((state, chunk) => reduceWalkthrough(state, chunk), initialWalkthroughState());

describe("initialWalkthroughState", () => {
  it("starts empty and streaming", () => {
    expect(initialWalkthroughState()).toEqual({
      summary: null,
      steps: [],
      status: "streaming",
      error: null,
      usage: null,
    });
  });
});

describe("reduceWalkthrough", () => {
  it("sets the summary from a summary chunk", () => {
    const state = reduceAll([{ type: "summary", summary }]);

    expect(state.summary).toEqual(summary);
    expect(state.status).toBe("streaming");
  });

  it("appends a step into the ordered list", () => {
    const state = reduceAll([{ type: "step", step: step(3, "only") }]);

    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]?.title).toBe("only");
  });

  it("keeps steps ordered by the model order even when they arrive out of sequence", () => {
    const state = reduceAll([
      { type: "step", step: step(2, "third") },
      { type: "step", step: step(0, "first") },
      { type: "step", step: step(1, "second") },
    ]);

    // Steps are sorted by their order field.
    expect(state.steps.map((s) => s.title)).toEqual(["first", "second", "third"]);
  });

  it("sets status and error from an error chunk", () => {
    const state = reduceAll([{ type: "error", kind: "max_tokens", message: "too long" }]);

    expect(state.status).toBe("error");
    expect(state.error).toEqual({ kind: "max_tokens", message: "too long" });
  });

  it("records usage from a usage chunk", () => {
    const state = reduceAll([{ type: "usage", inputTokens: 100, outputTokens: 50, costUsd: 0.25 }]);

    expect(state.usage).toEqual({ inputTokens: 100, outputTokens: 50, costUsd: 0.25 });
    expect(state.status).toBe("streaming");
  });

  it("marks the stream done on a done chunk", () => {
    const state = reduceAll([{ type: "done" }]);

    expect(state.status).toBe("done");
  });

  it("threads summary, steps, usage, and done into one final state", () => {
    const state = reduceAll([
      { type: "summary", summary },
      { type: "step", step: step(0, "first") },
      { type: "step", step: step(1, "second") },
      { type: "usage", inputTokens: 10, outputTokens: 20, costUsd: 0.01 },
      { type: "done" },
    ]);

    expect(state.summary).toEqual(summary);
    expect(state.steps.map((s) => s.title)).toEqual(["first", "second"]);
    expect(state.usage?.costUsd).toBe(0.01);
    expect(state.status).toBe("done");
  });

  it("ends with no steps (thin result) when only a summary and done arrive", () => {
    const state = reduceAll([{ type: "summary", summary }, { type: "done" }]);

    expect(state.summary).toEqual(summary);
    expect(state.steps).toEqual([]);
    expect(state.status).toBe("done");
  });

  it("ignores an unknown future chunk type without crashing", () => {
    const unknown = { type: "future" } as unknown as WalkthroughChunk;
    const state = reduceWalkthrough(initialWalkthroughState(), unknown);

    expect(state).toEqual(initialWalkthroughState());
  });

  it("does not mutate the input state", () => {
    const before = initialWalkthroughState();
    reduceWalkthrough(before, { type: "summary", summary });

    expect(before.summary).toBeNull();
  });
});

// Yields the given chunks one at a time.
const streamChunks = async function* streamChunksGen(
  chunks: WalkthroughChunk[],
): AsyncIterable<WalkthroughChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
};

// A fake source that streams a fixed chunk list. The other methods return empty
// values so an accidental call does not throw.
const fakeSource = (chunks: WalkthroughChunk[]): ReviewDataSource => ({
  context: { sessionId: "x", mode: "pr", viewer: null, repo: null } satisfies ReviewContext,
  getReview: async (): Promise<ReviewData> => await Promise.resolve(EMPTY_REVIEW),
  startWalkthrough: async (): Promise<{ jobId: string }> =>
    await Promise.resolve({ jobId: "job-1" }),
  streamWalkthrough: (): AsyncIterable<WalkthroughChunk> => streamChunks(chunks),
  cancelWalkthrough: async (): Promise<void> => await Promise.resolve(),
  listComments: async (): Promise<Comment[]> => await Promise.resolve([]),
  listDrafts: async (): Promise<CommentDraft[]> => await Promise.resolve([]),
  draftComment: async (): Promise<void> => await Promise.resolve(),
  submitReview: async (): Promise<void> => await Promise.resolve(),
  capabilities: { comments: true },
});

describe("consumeWalkthrough", () => {
  it("drives the stream through the reducer and reports each state", async () => {
    const states: WalkthroughState[] = [];
    const source = fakeSource([
      { type: "summary", summary },
      { type: "step", step: step(0, "first") },
      { type: "done" },
    ]);

    const final = await consumeWalkthrough(source, "job-1", (state) => states.push(state));

    // The starting state plus one for each chunk.
    expect(states).toHaveLength(4);
    expect(states[0]?.status).toBe("streaming");
    expect(states[0]?.summary).toBeNull();
    expect(final.summary).toEqual(summary);
    expect(final.steps.map((s) => s.title)).toEqual(["first"]);
    expect(final.status).toBe("done");
  });

  it("reports the initial generating state before any chunk arrives", async () => {
    const states: WalkthroughState[] = [];
    const source = fakeSource([]);

    await consumeWalkthrough(source, "job-1", (state) => states.push(state));

    expect(states).toEqual([initialWalkthroughState()]);
  });
});
