// Tests for prepare_review: PR mode resolves auth, ingests, loads comments, and
// assembles a viewer/repo context and a working runner; path mode ingests locally
// with no comments and a null context. All helpers are fakes, so nothing real runs.

import type { WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { parseRunArgs } from "../../src/args/run_args.js";
import {
  prepareReview,
  type PreparedIngest,
  type PrepareReviewDeps,
} from "../../src/run/prepare_review.js";
import type { StreamEngineFn } from "../../src/run/walkthrough_runner.js";
import { FIXTURE_COMMENT, FIXTURE_REVIEW, noConfigLoader } from "../fixtures/review_fixture.js";

// A fake ingest over the fixture review.
const fakeIngest = (over: Partial<PreparedIngest> = {}): PreparedIngest => ({
  meta: FIXTURE_REVIEW.meta,
  diffModel: FIXTURE_REVIEW.diff,
  rawDiff: FIXTURE_REVIEW.diff.rawDiff,
  repoRoot: "/repo",
  cleanup: async () => {},
  ...over,
});

// The chunks the fake engine yields (summary, step, usage, done).
const STREAMED_CHUNKS: WalkthroughChunk[] = [
  {
    type: "summary",
    summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d"] },
  },
  {
    type: "step",
    step: { order: 0, hunkId: "h0", lineRange: null, title: "first", explanation: "e" },
  },
  { type: "usage", inputTokens: 1_200, outputTokens: 300, costUsd: 0.018 },
  { type: "done" },
];

const fakeStreamEngine: StreamEngineFn = async function* gen(): AsyncIterable<WalkthroughChunk> {
  for (const chunk of STREAMED_CHUNKS) {
    yield chunk;
  }
};

// Build the deps with sensible fakes; each test overrides what it needs.
const makeDeps = (over: Partial<PrepareReviewDeps> = {}): PrepareReviewDeps => ({
  loadConfig: noConfigLoader,
  resolvePrAuth: async () => ({ token: "tok", viewer: { login: "octocat" } }),
  ingestPr: async () => fakeIngest(),
  loadComments: async () => [FIXTURE_COMMENT],
  submitReview: async () => ({ htmlUrl: "https://example.com/r/1" }),
  ingestLocal: async () => fakeIngest(),
  streamEngine: fakeStreamEngine,
  newSessionId: () => "session-1",
  ...over,
});

const collect = async (it: AsyncIterable<WalkthroughChunk>): Promise<WalkthroughChunk[]> => {
  const out: WalkthroughChunk[] = [];
  for await (const chunk of it) {
    out.push(chunk);
  }
  return out;
};

describe("prepareReview: PR mode", () => {
  it("resolves auth, ingests, loads comments, and builds the review", async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      resolvePrAuth: async (ref) => {
        calls.push(`auth:${ref.owner}/${ref.repo}#${ref.number}`);
        return { token: "tok-xyz", viewer: { login: "octocat" } };
      },
      ingestPr: async (args) => {
        calls.push(`ingest:${args.token}:${args.localRepoPath ?? "none"}`);
        return fakeIngest();
      },
      loadComments: async (args) => {
        calls.push(`comments:${args.token}`);
        return [FIXTURE_COMMENT];
      },
    });
    const args = parseRunArgs(["https://github.com/octo/demo/pull/7"]);
    const prepared = await prepareReview(args, deps);

    expect(prepared.data.comments).toEqual([FIXTURE_COMMENT]);
    expect(prepared.context).toEqual({
      sessionId: "session-1",
      mode: "pr",
      viewer: { login: "octocat" },
      repo: { owner: "octo", name: "demo" },
    });
    // The steps ran in order with the resolved token passed through.
    expect(calls).toEqual(["auth:octo/demo#7", "ingest:tok-xyz:none", "comments:tok-xyz"]);
  });

  it("forwards --repo as the local repo path to ingestPr", async () => {
    const seenLocalPath: (string | undefined)[] = [];
    const deps = makeDeps({
      ingestPr: async (args) => {
        seenLocalPath.push(args.localRepoPath);
        return fakeIngest();
      },
    });
    const args = parseRunArgs(["octo/demo#7", "--repo", "/work/clone"]);
    await prepareReview(args, deps);
    expect(seenLocalPath[0]).toBe("/work/clone");
  });

  it("builds a runner that streams the engine's chunks incrementally", async () => {
    const prepared = await prepareReview(parseRunArgs(["octo/demo#7"]), makeDeps());
    const chunks = await collect(prepared.runWalkthrough(new AbortController().signal));
    expect(chunks.map((c) => c.type)).toEqual(["summary", "step", "usage", "done"]);
  });

  it("forwards the run logger into the engine via the runner", async () => {
    const logs: string[] = [];
    const streamEngine: StreamEngineFn = async function* gen(_input, _config, runDeps) {
      runDeps?.log?.("engine progress");
      yield { type: "done" } as WalkthroughChunk;
    };
    const deps = makeDeps({ log: (message) => logs.push(message), streamEngine });
    const prepared = await prepareReview(parseRunArgs(["octo/demo#7"]), deps);
    await collect(prepared.runWalkthrough(new AbortController().signal));
    expect(logs).toContain("engine progress");
  });

  it("binds a submit collaborator that forwards the stored drafts + ref + token", async () => {
    const submitCalls: { ref: string; token: string; event: string }[] = [];
    const deps = makeDeps({
      resolvePrAuth: async () => ({ token: "tok-abc", viewer: { login: "octocat" } }),
      submitReview: async (args) => {
        submitCalls.push({
          ref: `${args.ref.owner}/${args.ref.repo}#${args.ref.number}`,
          token: args.token,
          event: args.payload.event,
        });
        return { htmlUrl: "https://example.com/r/9" };
      },
    });
    const prepared = await prepareReview(parseRunArgs(["octo/demo#7"]), deps);
    const result = await prepared.submit?.({ event: "APPROVE" });

    expect(result).toEqual({ htmlUrl: "https://example.com/r/9" });
    expect(submitCalls).toEqual([{ ref: "octo/demo#7", token: "tok-abc", event: "APPROVE" }]);
  });

  it("runs the ingest cleanup when loadComments throws (no orphaned clone)", async () => {
    let cleaned = false;
    const deps = makeDeps({
      ingestPr: async () =>
        fakeIngest({
          cleanup: async () => {
            cleaned = true;
          },
        }),
      loadComments: async () => {
        throw new Error("comment fetch failed");
      },
    });
    await expect(prepareReview(parseRunArgs(["octo/demo#7"]), deps)).rejects.toThrow(
      "comment fetch failed",
    );
    // The clone the ingest created is removed before the error propagates.
    expect(cleaned).toBe(true);
  });

  it("binds a fetchComments collaborator that re-fetches with the ref + token + diff", async () => {
    const fetchCalls: { ref: string; token: string; rawDiff: string }[] = [];
    const deps = makeDeps({
      resolvePrAuth: async () => ({ token: "tok-abc", viewer: null }),
      loadComments: async (args) => {
        fetchCalls.push({
          ref: `${args.ref.owner}/${args.ref.repo}#${args.ref.number}`,
          token: args.token,
          rawDiff: args.rawDiff,
        });
        return [FIXTURE_COMMENT];
      },
    });
    const prepared = await prepareReview(parseRunArgs(["octo/demo#7"]), deps);
    const comments = await prepared.fetchComments?.();

    expect(comments).toEqual([FIXTURE_COMMENT]);
    // Both the first load and the live re-fetch went through loadComments.
    expect(fetchCalls.at(-1)).toEqual({
      ref: "octo/demo#7",
      token: "tok-abc",
      rawDiff: FIXTURE_REVIEW.diff.rawDiff,
    });
  });
});

describe("prepareReview: path mode", () => {
  it("ingests locally with no comments and a null context", async () => {
    let authCalled = false;
    const deps = makeDeps({
      resolvePrAuth: async () => {
        authCalled = true;
        return { token: "x", viewer: null };
      },
      ingestLocal: async (args) => {
        expect(args.repoPath).toBe("./some/dir");
        return fakeIngest();
      },
    });
    const args = parseRunArgs(["./some/dir"]);
    const prepared = await prepareReview(args, deps);

    expect(authCalled).toBe(false);
    expect(prepared.data.comments).toEqual([]);
    expect(prepared.context).toEqual({
      sessionId: "session-1",
      mode: "path",
      viewer: null,
      repo: null,
    });
    // Path mode has no GitHub, so no write or live helpers are bound.
    expect(prepared.submit).toBeUndefined();
    expect(prepared.fetchComments).toBeUndefined();
  });

  it("passes --base/--head through to ingestLocal", async () => {
    const ranges: { repoPath: string; base?: string; head?: string }[] = [];
    const deps = makeDeps({
      ingestLocal: async (args) => {
        ranges.push(args);
        return fakeIngest();
      },
    });
    const args = parseRunArgs([".", "--base", "main", "--head", "feature"]);
    await prepareReview(args, deps);
    expect(ranges[0]).toEqual({ repoPath: ".", base: "main", head: "feature" });
  });

  it("prefers --repo over the positional path for the local repo", async () => {
    const repoPaths: string[] = [];
    const deps = makeDeps({
      ingestLocal: async (args) => {
        repoPaths.push(args.repoPath);
        return fakeIngest();
      },
    });
    await prepareReview(parseRunArgs([".", "--repo", "/elsewhere"]), deps);
    expect(repoPaths[0]).toBe("/elsewhere");
  });

  it("returns the ingest cleanup", async () => {
    let cleaned = false;
    const deps = makeDeps({
      ingestLocal: async () =>
        fakeIngest({
          cleanup: async () => {
            cleaned = true;
          },
        }),
    });
    const prepared = await prepareReview(parseRunArgs(["."]), deps);
    await prepared.cleanup();
    expect(cleaned).toBe(true);
  });

  it("threads the resolved server knobs (idle + comment poll) onto the prepared review", async () => {
    // A project config with server overrides flows through to the prepared review's
    // idle window and poll interval.
    const deps = makeDeps({
      loadConfig: (location) =>
        location === "project"
          ? { server: { idle_timeout_ms: 123_000, comment_poll_ms: 4_000 } }
          : undefined,
    });
    const prepared = await prepareReview(parseRunArgs(["."]), deps);
    expect(prepared.idleTimeoutMs).toBe(123_000);
    expect(prepared.commentPollMs).toBe(4_000);
  });
});
