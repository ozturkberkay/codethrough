// Integration tests for composeStream's abort handling, split out of
// compose_stream.test.ts to keep that file under the length limit. Shows the abort
// signal reaches the provider's request (so a cancel stops the model request) and
// that aborting mid-stream stops the reading. Uses the fake provider; no network.

import type { WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { composeStream } from "../../src/compose_stream.js";
import type { HunkCatalog } from "../../src/hunk_catalog.js";
import { type ComposeCapture, fakeProvider, splitEvenly } from "./fake_provider.js";
import { makeEngineConfig } from "./make_engine_config.js";

const ENGINE_CONFIG = makeEngineConfig();

// Hunk h0 covers 1..3, h1 covers 10..11 (same as compose_stream.test.ts).
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

const walkthroughJson = (steps: object[]): string => JSON.stringify({ summary: SUMMARY, steps });

const collect = async (it: AsyncIterable<WalkthroughChunk>): Promise<WalkthroughChunk[]> => {
  const out: WalkthroughChunk[] = [];
  for await (const chunk of it) {
    out.push(chunk);
  }
  return out;
};

describe("composeStream: abort signal", () => {
  const steps = [{ order: 1, hunkId: "h0", lineRange: null, title: "t", explanation: "e" }];

  it("forwards the abort signal into the provider's compose request", async () => {
    const composeCapture: ComposeCapture = {};
    const controller = new AbortController();
    const provider = fakeProvider({ deltas: [walkthroughJson(steps)], composeCapture });
    await collect(
      composeStream(catalog, "brief", {
        provider,
        config: ENGINE_CONFIG,
        signal: controller.signal,
      }),
    );
    // The signal reached the provider call, so a cancel would stop the request.
    expect(composeCapture.request!.signal).toBe(controller.signal);
  });

  it("omits the request signal entirely when none is given", async () => {
    const composeCapture: ComposeCapture = {};
    const provider = fakeProvider({ deltas: [walkthroughJson(steps)], composeCapture });
    await collect(composeStream(catalog, "brief", { provider, config: ENGINE_CONFIG }));
    expect(composeCapture.request!.signal).toBeUndefined();
  });

  it("stops consuming the stream once the signal aborts mid-stream", async () => {
    // A multi-chunk stream that aborts after the first chunk; the abort-aware fake
    // then stops, so the later chunks are never read.
    const controller = new AbortController();
    const consumed: string[] = [];
    const full = walkthroughJson([
      { order: 1, hunkId: "h0", lineRange: null, title: "first", explanation: "e1" },
      { order: 2, hunkId: "h1", lineRange: [10, 11], title: "second", explanation: "e2" },
    ]);
    const provider = fakeProvider({
      deltas: splitEvenly(full, 6),
      abortAware: true,
      onDelta: (delta) => {
        consumed.push(delta);
        // Abort partway, right after the first chunk arrives.
        if (consumed.length === 1) {
          controller.abort();
        }
      },
    });
    await collect(
      composeStream(catalog, "brief", {
        provider,
        config: ENGINE_CONFIG,
        signal: controller.signal,
      }),
    );
    // Only the first chunk was read before the abort stopped the rest.
    expect(consumed).toHaveLength(1);
  });
});
