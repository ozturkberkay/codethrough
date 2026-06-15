// Integration tests for streamEngine: the
// build catalog -> trim catalog -> explore -> composeStream sequence with a fake
// provider and a no-op runner, so it runs without a network. Shows the phases are
// wired together (explore runs before compose), the catalog drives per-step checks
// against its real hunk ids, and the chunks (summary, numbered steps, usage, done)
// come out as they go.

import type { WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import type { CommandRunner } from "../../src/command.js";
import { streamEngine } from "../../src/stream_engine.js";
import type { EngineInput } from "../../src/types.js";
import { type ComposeCapture, fakeProvider } from "./fake_provider.js";
import { makeEngineConfig } from "./make_engine_config.js";

const ENGINE_CONFIG = makeEngineConfig();

// Two single-line added files give two hunks, h0 and h1 (same as run_engine.test.ts).
const TWO_HUNKS = `diff --git a/a.ts b/a.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/a.ts
@@ -0,0 +1,1 @@
+const a = 1;
diff --git a/b.ts b/b.ts
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/b.ts
@@ -0,0 +1,1 @@
+const b = 2;
`;

const input: EngineInput = {
  repoRoot: "/repo",
  rawDiff: TWO_HUNKS,
  meta: { title: "t", body: "b", baseRef: "main", headRef: "feature" },
};

const noopRunner: CommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 0 });

const WALKTHROUGH_JSON = JSON.stringify({
  summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d"] },
  steps: [
    { order: 9, hunkId: "h1", lineRange: null, title: "second", explanation: "e" },
    { order: 4, hunkId: "h0", lineRange: null, title: "first", explanation: "e" },
  ],
});

const collect = async (it: AsyncIterable<WalkthroughChunk>): Promise<WalkthroughChunk[]> => {
  const out: WalkthroughChunk[] = [];
  for await (const chunk of it) {
    out.push(chunk);
  }
  return out;
};

describe("streamEngine", () => {
  it("sequences explore -> composeStream and yields the chunk stream", async () => {
    const provider = fakeProvider({
      brief: "a brief",
      deltas: [WALKTHROUGH_JSON],
      inputTokens: 2_000,
      outputTokens: 500,
    });
    const chunks = await collect(streamEngine(input, ENGINE_CONFIG, { provider, run: noopRunner }));

    expect(chunks.map((c) => c.type)).toEqual(["summary", "step", "step", "usage", "done"]);
    // The steps come in stream order, numbered 0, 1 by arrival (not the model's 9/4),
    // so the first one is "second".
    const titles = chunks
      .filter((c): c is Extract<WalkthroughChunk, { type: "step" }> => c.type === "step")
      .map((c) => `${c.step.order}:${c.step.title}`);
    expect(titles).toEqual(["0:second", "1:first"]);
  });

  it("logs progress through the injected logger", async () => {
    const logs: string[] = [];
    const provider = fakeProvider({ brief: "b", deltas: [WALKTHROUGH_JSON] });
    await collect(
      streamEngine(input, ENGINE_CONFIG, {
        provider,
        run: noopRunner,
        log: (m) => logs.push(m),
      }),
    );
    expect(logs.some((l) => /Catalog:/.test(l))).toBe(true);
    expect(logs.some((l) => /phase 2, streaming/.test(l))).toBe(true);
  });

  it("threads deps.signal into the streaming compose so a cancel aborts the request", async () => {
    const composeCapture: ComposeCapture = {};
    const controller = new AbortController();
    const provider = fakeProvider({ brief: "b", deltas: [WALKTHROUGH_JSON], composeCapture });
    await collect(
      streamEngine(input, ENGINE_CONFIG, {
        provider,
        run: noopRunner,
        signal: controller.signal,
      }),
    );
    // The run signal reached the compose stream's provider call.
    expect(composeCapture.request!.signal).toBe(controller.signal);
  });

  it("re-indexes around a step whose hunk id is not in the catalog", async () => {
    // The id h9 is not in the catalog (only h0/h1 exist), so that step is dropped and
    // the kept steps stay numbered with no gaps.
    const json = JSON.stringify({
      summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: [] },
      steps: [
        { order: 1, hunkId: "h0", lineRange: null, title: "keep-a", explanation: "e" },
        { order: 2, hunkId: "h9", lineRange: null, title: "drop", explanation: "e" },
        { order: 3, hunkId: "h1", lineRange: null, title: "keep-b", explanation: "e" },
      ],
    });
    const provider = fakeProvider({ brief: "b", deltas: [json] });
    const chunks = await collect(streamEngine(input, ENGINE_CONFIG, { provider, run: noopRunner }));
    const steps = chunks.filter(
      (c): c is Extract<WalkthroughChunk, { type: "step" }> => c.type === "step",
    );
    expect(steps.map((c) => c.step.title)).toEqual(["keep-a", "keep-b"]);
    expect(steps.map((c) => c.step.order)).toEqual([0, 1]);
  });
});
