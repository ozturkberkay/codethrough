// Integration tests for compose() (the batch path) with a fake provider, so the
// request the engine builds (prompt, output schema, max tokens), the stop-reason
// handling, and the re-check of the collected output all run without a network.

import type { Walkthrough } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { compose } from "../../src/compose.js";
import type { HunkCatalog } from "../../src/hunk_catalog.js";
import { type ComposeCapture, fakeProvider, splitEvenly } from "./fake_provider.js";
import { makeEngineConfig } from "./make_engine_config.js";

const ENGINE_CONFIG = makeEngineConfig();

const catalog: HunkCatalog = {
  hunks: [{ id: "h0", file: "a.ts", status: "modified", lines: [{ line: 1, content: "x" }] }],
  rows: [],
};

const walkthrough: Walkthrough = {
  summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d"] },
  steps: [{ order: 1, hunkId: "h0", lineRange: null, title: "t", explanation: "e" }],
};

const json = (w: unknown): string => JSON.stringify(w);

describe("compose", () => {
  it("returns the re-validated walkthrough from the accumulated streamed output", async () => {
    // The output is split into several chunks to show compose joins them.
    const provider = fakeProvider({ deltas: splitEvenly(json(walkthrough), 5) });
    const out = await compose(catalog, "brief", { provider, config: ENGINE_CONFIG });
    expect(out).toEqual(walkthrough);
  });

  it("sends the compose prompt, the object output schema, and a positive max_tokens", async () => {
    const composeCapture: ComposeCapture = {};
    const provider = fakeProvider({ deltas: [json(walkthrough)], composeCapture });
    await compose(catalog, "brief", { provider, config: ENGINE_CONFIG });
    const req = composeCapture.request!;
    expect(req.prompt).toContain("### h0 (a.ts, modified)");
    expect(req.outputSchema["type"]).toBe("object");
    expect(req.maxTokens).toBeGreaterThan(0);
  });

  it("passes the truncation note into the prompt when the catalog is partial", async () => {
    const composeCapture: ComposeCapture = {};
    const provider = fakeProvider({ deltas: [json(walkthrough)], composeCapture });
    await compose(catalog, "brief", { provider, config: ENGINE_CONFIG, truncated: true });
    expect(composeCapture.request!.prompt).toContain("PARTIAL");
  });

  it("logs the finish through the injected logger", async () => {
    const logs: string[] = [];
    const provider = fakeProvider({ deltas: [json(walkthrough)] });
    await compose(catalog, "brief", { provider, config: ENGINE_CONFIG, log: (m) => logs.push(m) });
    expect(logs.some((l) => /Compose finished/.test(l))).toBe(true);
  });

  it("throws on a max_tokens stop (no usable walkthrough)", async () => {
    const provider = fakeProvider({ deltas: [], stopReason: "max_tokens" });
    await expect(compose(catalog, "brief", { provider, config: ENGINE_CONFIG })).rejects.toThrow(
      /max_tokens/,
    );
  });

  it("throws on a refusal stop (no usable walkthrough)", async () => {
    const provider = fakeProvider({ deltas: [], stopReason: "refusal" });
    await expect(compose(catalog, "brief", { provider, config: ENGINE_CONFIG })).rejects.toThrow(
      /refusal/,
    );
  });

  it("throws when the streamed output is not valid JSON", async () => {
    const provider = fakeProvider({ deltas: ["this is not json"] });
    await expect(compose(catalog, "brief", { provider, config: ENGINE_CONFIG })).rejects.toThrow(
      /no parsed walkthrough/i,
    );
  });

  it("throws when the streamed output is a structurally invalid walkthrough", async () => {
    const bad = { summary: { problem: "only" } };
    const provider = fakeProvider({ deltas: [json(bad)] });
    await expect(compose(catalog, "brief", { provider, config: ENGINE_CONFIG })).rejects.toThrow(
      /invalid walkthrough/i,
    );
  });
});
