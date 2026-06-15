// Most imports here are just validators from one library, so the rule that
// limits dependency count does not apply.
/* oxlint-disable import/max-dependencies */
import {
  type InferOutput,
  literal,
  maxLength,
  number,
  object,
  picklist,
  pipe,
  string,
  variant,
} from "valibot";
import { Step } from "./step.js";
import { Summary } from "./summary.js";

/// Cap on error message size, so an oversized message fails cleanly here.
const MAX_ERROR_MESSAGE_LENGTH = 8_192;

/// The summary arrives first, before any steps.
const SummaryChunk = object({ type: literal("summary"), summary: Summary });

/// One step, sent once it passes validation.
const StepChunk = object({ type: literal("step"), step: Step });

/// The model refused, ran out of tokens, or sent output we could not parse.
const ErrorChunk = object({
  type: literal("error"),
  kind: picklist(["refusal", "max_tokens", "parse"]),
  message: pipe(string(), maxLength(MAX_ERROR_MESSAGE_LENGTH)),
});

/// Token counts and estimated cost for the run.
const UsageChunk = object({
  type: literal("usage"),
  inputTokens: number(),
  outputTokens: number(),
  costUsd: number(),
});

/// The stream is complete.
const DoneChunk = object({ type: literal("done") });

/// One message on the walkthrough stream, picked by its `type` field. We check
/// these at runtime because they arrive over the network.
export const WalkthroughChunk = variant("type", [
  SummaryChunk,
  StepChunk,
  ErrorChunk,
  UsageChunk,
  DoneChunk,
]);

export type WalkthroughChunk = InferOutput<typeof WalkthroughChunk>;
