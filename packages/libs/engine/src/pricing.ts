// Works out the cost of a run from token counts and a small rate table. No I/O. An
// unknown model costs 0 (the caller logs a note), so a new model never crashes the
// stream; add a model by editing the table or passing your own.
//
// Rates are USD per million tokens, the way Anthropic lists them.

/** USD rates per million tokens for one model. */
interface ModelRate {
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
}

/** Token counts to price, taken from the final message. */
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// One million, to divide token counts down to the per-million rates.
const TOKENS_PER_MILLION = 1_000_000;

/**
 * The rate table, keyed by exact model id. Edit it to add a model, or pass your own
 * table to estimateCostUsd.
 */
const MODEL_PRICING: Readonly<Record<string, ModelRate>> = {
  "claude-opus-4-8": { inputPerMillion: 5, outputPerMillion: 25 },
};

/**
 * Work out the run cost in USD from the model id and token counts. A model not in the
 * table costs 0 (the caller notes it) instead of throwing. The table can be passed in
 * for tests and new models; it defaults to the one above.
 */
const estimateCostUsd = (
  model: string,
  usage: TokenUsage,
  pricing: Readonly<Record<string, ModelRate>> = MODEL_PRICING,
): number => {
  const rate = pricing[model];
  if (rate === undefined) {
    return 0;
  }
  const inputCost = (usage.inputTokens / TOKENS_PER_MILLION) * rate.inputPerMillion;
  const outputCost = (usage.outputTokens / TOKENS_PER_MILLION) * rate.outputPerMillion;
  return inputCost + outputCost;
};

/** True if the model is in the rate table (drives the "unknown model" note). */
const isKnownModel = (
  model: string,
  pricing: Readonly<Record<string, ModelRate>> = MODEL_PRICING,
): boolean => pricing[model] !== undefined;

export { estimateCostUsd, isKnownModel, MODEL_PRICING };
export type { ModelRate, TokenUsage };
