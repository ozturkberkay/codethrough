// Tests for the cost estimator: a known model is priced from the rate table; an
// unknown model costs 0 (the caller notes it). The default model's rate is pinned so
// a silent price change fails the test.

import { describe, expect, it } from "vitest";

import { estimateCostUsd, isKnownModel, MODEL_PRICING, type ModelRate } from "../../src/pricing.js";

describe("estimateCostUsd", () => {
  it("prices the default model from its per-million input/output rates", () => {
    // Rates for claude-opus-4-8: $5 / 1M input, $25 / 1M output. 200k in + 40k out
    // = 0.2 * 5 + 0.04 * 25 = 1.0 + 1.0 = 2.0 USD.
    const cost = estimateCostUsd("claude-opus-4-8", { inputTokens: 200_000, outputTokens: 40_000 });
    expect(cost).toBeCloseTo(2, 10);
  });

  it("scales linearly with token counts", () => {
    const one = estimateCostUsd("claude-opus-4-8", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(one).toBeCloseTo(5, 10);
    const out = estimateCostUsd("claude-opus-4-8", { inputTokens: 0, outputTokens: 1_000_000 });
    expect(out).toBeCloseTo(25, 10);
  });

  it("is 0 for zero usage", () => {
    expect(estimateCostUsd("claude-opus-4-8", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("returns 0 for a model absent from the table", () => {
    expect(estimateCostUsd("some-future-model", { inputTokens: 999, outputTokens: 999 })).toBe(0);
  });

  it("uses an injected override table when provided", () => {
    const table: Record<string, ModelRate> = {
      "tiny-1": { inputPerMillion: 1, outputPerMillion: 2 },
    };
    const cost = estimateCostUsd(
      "tiny-1",
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      table,
    );
    expect(cost).toBeCloseTo(3, 10);
    // The default model is NOT in the override table, so it prices to 0 there.
    expect(estimateCostUsd("claude-opus-4-8", { inputTokens: 1, outputTokens: 1 }, table)).toBe(0);
  });
});

describe("isKnownModel", () => {
  it("is true for a model in the table and false otherwise", () => {
    expect(isKnownModel("claude-opus-4-8")).toBe(true);
    expect(isKnownModel("nope")).toBe(false);
  });

  it("respects an injected override table", () => {
    const table: Record<string, ModelRate> = { only: { inputPerMillion: 1, outputPerMillion: 1 } };
    expect(isKnownModel("only", table)).toBe(true);
    expect(isKnownModel("claude-opus-4-8", table)).toBe(false);
  });
});

describe("MODEL_PRICING", () => {
  it("pins the default model's published rate", () => {
    expect(MODEL_PRICING["claude-opus-4-8"]).toEqual({ inputPerMillion: 5, outputPerMillion: 25 });
  });
});
