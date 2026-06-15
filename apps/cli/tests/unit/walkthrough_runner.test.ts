// Tests for the walkthrough runner: it forwards each chunk the engine yields, in
// order; an already-aborted signal yields nothing; an abort part-way through stops
// early; and an unexpected engine throw becomes a final error chunk of the right
// kind.

import type { EngineConfig, EngineInput } from "@codethrough/engine";
import type { WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import {
  createWalkthroughRunner,
  errorChunkFor,
  messageOf,
  type StreamEngineFn,
} from "../../src/run/walkthrough_runner.js";

const INPUT: EngineInput = {
  rawDiff: "diff",
  repoRoot: "/repo",
  meta: { title: "t", body: "b", baseRef: "main", headRef: "feature" },
};
const CONFIG: EngineConfig = {
  model: "m",
  effort: "high",
  maxHunks: 60,
  compose: { maxTokens: 64_000 },
  explore: {
    maxTokens: 16_000,
    maxIterations: 30,
    phaseTimeoutMs: 600_000,
    toolTimeoutMs: 15_000,
    maxFileBytes: 65_536,
    maxMatches: 200,
  },
  catalog: { maxHunkRows: 400, maxTotalRows: 6_000, maxTotalChars: 400_000 },
};

const CHUNKS: WalkthroughChunk[] = [
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

// A fake engine that yields the given chunks (no real engine, no API).
const fakeStreamEngine = (chunks: WalkthroughChunk[]): StreamEngineFn =>
  async function* gen(): AsyncIterable<WalkthroughChunk> {
    for (const chunk of chunks) {
      yield chunk;
    }
  };

const collect = async (it: AsyncIterable<WalkthroughChunk>): Promise<WalkthroughChunk[]> => {
  const out: WalkthroughChunk[] = [];
  for await (const chunk of it) {
    out.push(chunk);
  }
  return out;
};

describe("createWalkthroughRunner", () => {
  it("forwards each streamed chunk in order", async () => {
    const runner = createWalkthroughRunner({
      streamEngine: fakeStreamEngine(CHUNKS),
      input: INPUT,
      config: CONFIG,
    });
    const chunks = await collect(runner(new AbortController().signal));
    expect(chunks).toEqual(CHUNKS);
  });

  it("forwards a progress logger into the engine", async () => {
    const seen: string[] = [];
    const streamEngine: StreamEngineFn = async function* gen(_input, _config, deps) {
      deps?.log?.("hello");
      yield { type: "done" } as WalkthroughChunk;
    };
    const runner = createWalkthroughRunner({
      streamEngine,
      input: INPUT,
      config: CONFIG,
      log: (m) => seen.push(m),
    });
    await collect(runner(new AbortController().signal));
    expect(seen).toEqual(["hello"]);
  });

  it("threads the run signal into the engine (so a cancel aborts the billed stream)", async () => {
    const seen: { signal: AbortSignal | undefined } = { signal: undefined };
    const streamEngine: StreamEngineFn = async function* gen(_input, _config, deps) {
      seen.signal = deps?.signal;
      yield { type: "done" } as WalkthroughChunk;
    };
    const runner = createWalkthroughRunner({ streamEngine, input: INPUT, config: CONFIG });
    const controller = new AbortController();
    await collect(runner(controller.signal));
    // The same signal the source passes is handed to the engine.
    expect(seen.signal).toBe(controller.signal);
  });

  it("yields a terminal error chunk when the engine throws unexpectedly", async () => {
    const streamEngine: StreamEngineFn = async function* gen(): AsyncIterable<WalkthroughChunk> {
      yield {
        type: "summary",
        summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: [] },
      };
      throw new Error("compose failed: max_tokens");
    };
    const runner = createWalkthroughRunner({ streamEngine, input: INPUT, config: CONFIG });
    const chunks = await collect(runner(new AbortController().signal));
    // The summary already streamed, then the throw becomes a final error chunk.
    expect(chunks.map((c) => c.type)).toEqual(["summary", "error"]);
    expect(chunks.at(-1)).toEqual({
      type: "error",
      kind: "max_tokens",
      message: "compose failed: max_tokens",
    });
  });

  it("yields nothing when the signal is already aborted", async () => {
    const runner = createWalkthroughRunner({
      streamEngine: fakeStreamEngine(CHUNKS),
      input: INPUT,
      config: CONFIG,
    });
    const controller = new AbortController();
    controller.abort();
    expect(await collect(runner(controller.signal))).toEqual([]);
  });

  it("stops mid-stream when the signal aborts", async () => {
    const controller = new AbortController();
    // An engine that aborts the signal after the first chunk; the runner must stop.
    const streamEngine: StreamEngineFn = async function* gen(): AsyncIterable<WalkthroughChunk> {
      yield {
        type: "summary",
        summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: [] },
      };
      controller.abort();
      yield { type: "done" };
    };
    const runner = createWalkthroughRunner({ streamEngine, input: INPUT, config: CONFIG });
    const chunks = await collect(runner(controller.signal));
    expect(chunks.map((c) => c.type)).toEqual(["summary"]);
  });
});

describe("errorChunkFor", () => {
  it("classifies the engine stop reason", () => {
    expect(errorChunkFor("x max_tokens y").kind).toBe("max_tokens");
    expect(errorChunkFor("model refusal").kind).toBe("refusal");
    expect(errorChunkFor("anything else").kind).toBe("parse");
  });
});

describe("messageOf", () => {
  it("reads an Error's message and falls back for a non-Error", () => {
    expect(messageOf(new Error("compose failed: max_tokens"))).toBe("compose failed: max_tokens");
    // A non-Error throw carries no reliable message, so the generic fallback is used.
    expect(messageOf({ notAnError: true })).toBe("engine run failed");
    expect(messageOf("boom")).toBe("engine run failed");
  });
});
