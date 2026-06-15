// Integration tests for composeStream() with a fake provider, so the stream wiring,
// the request the engine builds, the read -> check -> chunk pipeline, the usage and
// cost, and the error paths all run without a network. The key checks: the order
// (summary first, then the numbered step chunks, then usage with real counts and
// cost, then done), and that a token-limit cut mid-list yields no half step and an
// error chunk.

import type { WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { composeStream } from "../../src/compose_stream.js";
import type { HunkCatalog } from "../../src/hunk_catalog.js";
import { type ComposeCapture, fakeProvider, splitEvenly } from "./fake_provider.js";
import { makeEngineConfig } from "./make_engine_config.js";

const ENGINE_CONFIG = makeEngineConfig();

// Hunk h0 covers 1..3, h1 covers 10..11; an unknown id (h99) is dropped, showing the
// numbering skips it.
const catalog: HunkCatalog = {
  hunks: [
    {
      id: "h0",
      file: "a.ts",
      status: "modified",
      lines: [
        { line: 1, content: "one" },
        { line: 2, content: "two" },
        { line: 3, content: "three" },
      ],
    },
    {
      id: "h1",
      file: "b.ts",
      status: "added",
      lines: [
        { line: 10, content: "ten" },
        { line: 11, content: "eleven" },
      ],
    },
  ],
  rows: [],
};

const SUMMARY = { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d1", "d2"] };

// Build the streamed JSON for a walkthrough.
const walkthroughJson = (steps: object[]): string => JSON.stringify({ summary: SUMMARY, steps });

const collect = async (it: AsyncIterable<WalkthroughChunk>): Promise<WalkthroughChunk[]> => {
  const out: WalkthroughChunk[] = [];
  for await (const chunk of it) {
    out.push(chunk);
  }
  return out;
};

describe("composeStream: happy path sequence", () => {
  const steps = [
    { order: 5, hunkId: "h0", lineRange: null, title: "first", explanation: "e1" },
    { order: 9, hunkId: "h1", lineRange: [10, 11], title: "second", explanation: "e2" },
  ];

  it("emits summary, each step (re-indexed), usage with real counts, then done", async () => {
    const provider = fakeProvider({
      deltas: splitEvenly(walkthroughJson(steps), 7),
      inputTokens: 1_000_000,
      outputTokens: 40_000,
    });
    const chunks = await collect(
      composeStream(catalog, "brief", { provider, config: ENGINE_CONFIG }),
    );

    expect(chunks.map((c) => c.type)).toEqual(["summary", "step", "step", "usage", "done"]);
    expect(chunks[0]).toEqual({ type: "summary", summary: SUMMARY });
    // Steps are numbered 0, 1 by arrival (the model's 5/9 are dropped).
    expect(chunks[1]).toEqual({
      type: "step",
      step: { order: 0, hunkId: "h0", lineRange: null, title: "first", explanation: "e1" },
    });
    expect(chunks[2]).toEqual({
      type: "step",
      step: { order: 1, hunkId: "h1", lineRange: [10, 11], title: "second", explanation: "e2" },
    });
    // Cost for claude-opus-4-8: 1M in * $5 + 40k out * $25/1M = 5 + 1 = 6 USD.
    expect(chunks[3]).toEqual({
      type: "usage",
      inputTokens: 1_000_000,
      outputTokens: 40_000,
      costUsd: 6,
    });
  });

  it("sends the compose prompt and the object output schema to the provider", async () => {
    const composeCapture: ComposeCapture = {};
    const provider = fakeProvider({ deltas: [walkthroughJson(steps)], composeCapture });
    await collect(composeStream(catalog, "brief", { provider, config: ENGINE_CONFIG }));
    const req = composeCapture.request!;
    expect(req.prompt).toContain("### h0 (a.ts, modified)");
    expect(req.outputSchema["type"]).toBe("object");
    expect(req.maxTokens).toBeGreaterThan(0);
  });

  it("reports cost 0 with a logged note for an unknown model", async () => {
    const logs: string[] = [];
    const provider = fakeProvider({
      modelId: "mystery-model",
      deltas: [walkthroughJson(steps)],
      inputTokens: 100,
      outputTokens: 100,
    });
    const chunks = await collect(
      composeStream(catalog, "brief", {
        config: makeEngineConfig({ model: "mystery-model" }),
        provider,
        log: (m) => logs.push(m),
      }),
    );
    const usage = chunks.find((c) => c.type === "usage");
    expect(usage).toEqual({ type: "usage", inputTokens: 100, outputTokens: 100, costUsd: 0 });
    expect(logs.some((l) => /No pricing for model "mystery-model"/.test(l))).toBe(true);
  });
});

describe("composeStream: per-step validation as steps arrive", () => {
  it("drops a step with an unknown hunk id and re-indexes survivors", async () => {
    const steps = [
      { order: 1, hunkId: "h0", lineRange: null, title: "keep-a", explanation: "e" },
      { order: 2, hunkId: "h99", lineRange: null, title: "drop-me", explanation: "e" },
      { order: 3, hunkId: "h1", lineRange: null, title: "keep-b", explanation: "e" },
    ];
    const logs: string[] = [];
    const provider = fakeProvider({ deltas: splitEvenly(walkthroughJson(steps), 5) });
    const chunks = await collect(
      composeStream(catalog, "brief", {
        provider,
        config: ENGINE_CONFIG,
        log: (m) => logs.push(m),
      }),
    );

    const stepChunks = chunks.filter((c) => c.type === "step");
    expect(stepChunks.map((c) => (c.type === "step" ? c.step.title : ""))).toEqual([
      "keep-a",
      "keep-b",
    ]);
    // The two kept steps are numbered 0, 1 even though the middle one was dropped.
    expect(stepChunks.map((c) => (c.type === "step" ? c.step.order : -1))).toEqual([0, 1]);
    expect(logs.some((l) => /Dropped streamed step:.*h99/.test(l))).toBe(true);
  });

  it("resets an out-of-range lineRange to null (kept as a whole-hunk step)", async () => {
    const steps = [{ order: 1, hunkId: "h0", lineRange: [2, 9], title: "t", explanation: "e" }];
    const provider = fakeProvider({ deltas: [walkthroughJson(steps)] });
    const chunks = await collect(
      composeStream(catalog, "brief", { provider, config: ENGINE_CONFIG }),
    );
    const step = chunks.find((c) => c.type === "step");
    expect(step?.type === "step" && step.step.lineRange).toBeNull();
  });

  it("skips a malformed summary but still streams the steps + usage + done", async () => {
    // A summary missing required fields must not stop the stream.
    const json = JSON.stringify({
      summary: { problem: "only" },
      steps: [{ order: 1, hunkId: "h0", lineRange: null, title: "t", explanation: "e" }],
    });
    const logs: string[] = [];
    const provider = fakeProvider({ deltas: [json] });
    const chunks = await collect(
      composeStream(catalog, "brief", {
        provider,
        config: ENGINE_CONFIG,
        log: (m) => logs.push(m),
      }),
    );
    expect(chunks.map((c) => c.type)).toEqual(["step", "usage", "done"]);
    expect(logs.some((l) => /summary did not validate/i.test(l))).toBe(true);
  });
});

describe("composeStream: error paths", () => {
  it("emits a refusal error chunk and no usage/done on a refusal stop", async () => {
    const provider = fakeProvider({ deltas: [], stopReason: "refusal" });
    const chunks = await collect(
      composeStream(catalog, "brief", { provider, config: ENGINE_CONFIG }),
    );
    expect(chunks).toEqual([
      {
        type: "error",
        kind: "refusal",
        message: "compose stopped without a usable walkthrough: refusal",
      },
    ]);
  });

  it("on a max_tokens cut MID-ARRAY emits the closed steps, no partial, then an error", async () => {
    // The stream finishes the summary and the first step, then is cut inside the
    // second step (its closing brace never arrives) and stops at the token limit.
    const full = walkthroughJson([
      { order: 1, hunkId: "h0", lineRange: null, title: "first", explanation: "e1" },
      { order: 2, hunkId: "h1", lineRange: null, title: "second", explanation: "e2" },
    ]);
    const cutAt = full.indexOf('"second"');
    const provider = fakeProvider({ deltas: [full.slice(0, cutAt)], stopReason: "max_tokens" });
    const chunks = await collect(
      composeStream(catalog, "brief", { provider, config: ENGINE_CONFIG }),
    );
    // Summary and the one finished step, then the error. No second step, no usage, no
    // done.
    expect(chunks.map((c) => c.type)).toEqual(["summary", "step", "error"]);
    expect(chunks.at(-1)).toEqual({
      type: "error",
      kind: "max_tokens",
      message: "compose stopped without a usable walkthrough: max_tokens",
    });
    const [, step] = chunks;
    expect(step?.type === "step" && step.step.title).toBe("first");
  });

  it("emits a parse error chunk when the stream ends normally with nothing usable", async () => {
    // The model emitted garbage, so neither a summary nor a step came out; a normal
    // stop with nothing parsed is a parse failure (no usage or done).
    const provider = fakeProvider({ deltas: ["this is not json at all"] });
    const chunks = await collect(
      composeStream(catalog, "brief", { provider, config: ENGINE_CONFIG }),
    );
    expect(chunks).toEqual([
      {
        type: "error",
        kind: "parse",
        message: "compose stopped without a usable walkthrough: end with no parseable output",
      },
    ]);
  });

  it("emits a parse error when a normal stop produced only a malformed summary and no steps", async () => {
    // The summary finished but did not pass the check and there are no steps, so
    // nothing usable came out; a normal stop then gives a parse error.
    const json = JSON.stringify({ summary: { problem: "only" }, steps: [] });
    const provider = fakeProvider({ deltas: [json] });
    const chunks = await collect(
      composeStream(catalog, "brief", { provider, config: ENGINE_CONFIG }),
    );
    expect(chunks.map((c) => c.type)).toEqual(["error"]);
    expect(chunks[0]).toMatchObject({ kind: "parse" });
  });

  it("treats an 'other' stop reason with usable output as a normal completion", async () => {
    // An "other" stop is not a refusal or the token limit, so a parsed walkthrough
    // still ends with usage and done.
    const steps = [{ order: 1, hunkId: "h0", lineRange: null, title: "t", explanation: "e" }];
    const provider = fakeProvider({ deltas: [walkthroughJson(steps)], stopReason: "other" });
    const chunks = await collect(
      composeStream(catalog, "brief", { provider, config: ENGINE_CONFIG }),
    );
    expect(chunks.map((c) => c.type)).toEqual(["summary", "step", "usage", "done"]);
  });

  it("emits a parse error on an 'other' stop reason with nothing usable", async () => {
    const provider = fakeProvider({ deltas: ["garbage"], stopReason: "other" });
    const chunks = await collect(
      composeStream(catalog, "brief", { provider, config: ENGINE_CONFIG }),
    );
    expect(chunks).toEqual([
      {
        type: "error",
        kind: "parse",
        message: "compose stopped without a usable walkthrough: other with no parseable output",
      },
    ]);
  });
});
