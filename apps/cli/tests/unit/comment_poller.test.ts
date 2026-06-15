// Tests for the comment poll loop: with a fake clock and fetch and a signal, it
// yields only the changes, waits one interval before each fetch, stops when
// aborted, and ends when a fetch fails. No real timers or network.

import type { Comment, CommentDelta } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { pollCommentDeltas } from "../../src/server/comment_poller.js";

const comment = (over: Partial<Comment> & { id: string }): Comment => ({
  path: "src/a.ts",
  body: "a comment",
  author: "octocat",
  line: 1,
  originalLine: 1,
  side: "RIGHT",
  startLine: null,
  subjectType: "line",
  inReplyToId: null,
  placement: {
    kind: "line",
    strategy: "exact",
    side: "additions",
    lineNumber: 1,
    spanStartLine: null,
  },
  ...over,
});

// Collect an async iterable into an array.
const collect = async (it: AsyncIterable<CommentDelta>): Promise<CommentDelta[]> => {
  const out: CommentDelta[] = [];
  for await (const delta of it) {
    out.push(delta);
  }
  return out;
};

// A fetch that returns the queued lists in turn, aborting once they run out so the
// loop ends. Counts the fetches.
const queuedFetch = (
  snapshots: Comment[][],
  controller: AbortController,
): { fetch: () => Promise<Comment[]>; count: () => number } => {
  let index = 0;
  return {
    fetch: async () => {
      const snapshot = snapshots[index] ?? [];
      index += 1;
      if (index >= snapshots.length) {
        controller.abort();
      }
      return await Promise.resolve(snapshot);
    },
    count: () => index,
  };
};

describe("pollCommentDeltas", () => {
  it("yields only the changed delta off the seeded snapshot", async () => {
    const controller = new AbortController();
    const seed = [comment({ id: "c1" })];
    const next = [comment({ id: "c1" }), comment({ id: "c2", body: "new" })];
    const fetcher = queuedFetch([next, next], controller);

    const deltas = await collect(
      pollCommentDeltas({
        initial: seed,
        fetchComments: fetcher.fetch,
        wait: async () => {},
        intervalMs: 10,
        signal: controller.signal,
      }),
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.added.map((c) => c.id)).toEqual(["c2"]);
  });

  it("emits nothing when each poll matches the previous snapshot", async () => {
    const controller = new AbortController();
    const seed = [comment({ id: "c1" })];
    const fetcher = queuedFetch([[comment({ id: "c1" })], [comment({ id: "c1" })]], controller);

    const deltas = await collect(
      pollCommentDeltas({
        initial: seed,
        fetchComments: fetcher.fetch,
        wait: async () => {},
        intervalMs: 10,
        signal: controller.signal,
      }),
    );
    expect(deltas).toEqual([]);
  });

  it("waits one interval before each fetch", async () => {
    const controller = new AbortController();
    const waited: number[] = [];
    const fetcher = queuedFetch([[comment({ id: "c1" })]], controller);

    await collect(
      pollCommentDeltas({
        initial: [],
        fetchComments: fetcher.fetch,
        wait: async (ms) => {
          waited.push(ms);
        },
        intervalMs: 25,
        signal: controller.signal,
      }),
    );
    // One wait happened before the single fetch.
    expect(waited).toEqual([25]);
  });

  it("stops immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let fetched = false;

    const deltas = await collect(
      pollCommentDeltas({
        initial: [],
        fetchComments: async () => {
          fetched = true;
          return [];
        },
        wait: async () => {},
        intervalMs: 10,
        signal: controller.signal,
      }),
    );
    expect(deltas).toEqual([]);
    expect(fetched).toBe(false);
  });

  it("stops without fetching when aborted during the wait", async () => {
    const controller = new AbortController();
    let fetched = false;

    const deltas = await collect(
      pollCommentDeltas({
        initial: [],
        fetchComments: async () => {
          fetched = true;
          return [];
        },
        // The wait aborts the signal, so the loop returns before the fetch.
        wait: async () => {
          controller.abort();
        },
        intervalMs: 10,
        signal: controller.signal,
      }),
    );
    expect(deltas).toEqual([]);
    expect(fetched).toBe(false);
  });

  it("ends the loop when a fetch rejects", async () => {
    const controller = new AbortController();
    const stream = pollCommentDeltas({
      initial: [],
      fetchComments: async () => {
        await Promise.resolve();
        throw new Error("network");
      },
      wait: async () => {},
      intervalMs: 10,
      signal: controller.signal,
    });
    await expect(collect(stream)).rejects.toThrow(/network/);
  });
});
