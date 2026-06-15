// Tests for compose's I/O-free helpers (re-exported through compose.ts): building the
// prompt, the output schema shape, and handling the collected output (the stop-reason
// guard plus parsing and re-checking the JSON). The streaming call is tested in the
// integration tier, so these need no network or API key.

import type { Walkthrough } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { buildPrompt, walkthroughFromOutput, walkthroughOutputSchema } from "../../src/compose.js";
import { validateWalkthrough } from "../../src/compose_output.js";
import type { HunkCatalog } from "../../src/hunk_catalog.js";

const catalog: HunkCatalog = {
  hunks: [
    {
      id: "h0",
      file: "src/client.ts",
      status: "modified",
      lines: [{ line: 1, content: "const x = 1;" }],
    },
    {
      id: "h1",
      file: "src/retry.ts",
      status: "added",
      lines: [{ line: 5, content: "export const retry = () => {};" }],
    },
  ],
  rows: [],
};
const brief = "retry() in src/retry.ts is called by src/client.ts.";

describe("buildPrompt", () => {
  it("includes every catalog hunk id and its lines", () => {
    const prompt = buildPrompt(catalog, brief);
    expect(prompt).toContain("### h0 (src/client.ts, modified)");
    expect(prompt).toContain("1: const x = 1;");
    expect(prompt).toContain("### h1 (src/retry.ts, added)");
    expect(prompt).toContain("5: export const retry = () => {};");
  });

  it("includes the context brief", () => {
    expect(buildPrompt(catalog, brief)).toContain(brief);
  });

  it("instructs the model to use only catalog hunk ids", () => {
    const prompt = buildPrompt(catalog, brief);
    expect(prompt).toMatch(/only use ids that appear in the catalog/i);
  });

  it("omits the partial-catalog note by default", () => {
    expect(buildPrompt(catalog, brief)).not.toContain("PARTIAL");
  });

  it("includes the partial-catalog note only when truncated", () => {
    const prompt = buildPrompt(catalog, brief, { truncated: true });
    expect(prompt).toContain("PARTIAL");
  });

  it("substitutes a placeholder for an empty brief", () => {
    expect(buildPrompt(catalog, "")).toContain("(no brief was produced)");
  });

  it("substitutes a placeholder for an empty catalog", () => {
    expect(buildPrompt({ hunks: [], rows: [] }, brief)).toContain("(catalog is empty)");
  });
});

describe("walkthroughOutputSchema", () => {
  it("builds a top-level object JSON schema (the structured-output requirement)", () => {
    // The provider needs a top-level "object" schema; this checks the one we give it.
    const schema = walkthroughOutputSchema();
    expect(schema["type"]).toBe("object");
  });
});

describe("walkthroughFromOutput", () => {
  const walkthrough: Walkthrough = {
    summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d"] },
    steps: [{ order: 1, hunkId: "h0", lineRange: [1, 1], title: "t", explanation: "e" }],
  };
  const json = JSON.stringify(walkthrough);

  it("returns the re-validated walkthrough on a normal (end) stop", () => {
    expect(walkthroughFromOutput(json, "end")).toEqual(walkthrough);
  });

  it("returns the re-validated walkthrough on an 'other' stop", () => {
    expect(walkthroughFromOutput(json, "other")).toEqual(walkthrough);
  });

  it("throws on a refusal stop", () => {
    expect(() => walkthroughFromOutput("", "refusal")).toThrow(/refusal/);
  });

  it("throws on a max_tokens stop", () => {
    expect(() => walkthroughFromOutput(json, "max_tokens")).toThrow(/max_tokens/);
  });

  it("throws when the accumulated output is not valid JSON", () => {
    expect(() => walkthroughFromOutput("not json", "end")).toThrow(/no parsed walkthrough/i);
  });

  it("throws an invalid-walkthrough error when valibot rejects the parsed output", () => {
    // The model's output format does not check the shape, so a wrong object reaches
    // walkthroughFromOutput and the schema check must reject it.
    const bad = JSON.stringify({ summary: { problem: "p" } });
    expect(() => walkthroughFromOutput(bad, "end")).toThrow(/invalid walkthrough/i);
  });
});

describe("validateWalkthrough", () => {
  it("rethrows a non-valibot error raised while reading the parsed output", () => {
    // A getter that throws makes the schema check raise something other than a schema
    // error, which must be rethrown as is, not relabeled. JSON.parse can never produce
    // this, so we test the checker directly.
    const evil = new Proxy(
      {},
      {
        get() {
          throw new TypeError("getter exploded");
        },
      },
    );
    expect(() => validateWalkthrough(evil)).toThrow(/getter exploded/);
  });
});
