// The output side of compose. No I/O. Builds the JSON schema the model targets, then
// parses and re-checks the result. Kept apart from compose.ts so each file stays
// small.
//
// The model streams its output as text. We only give it the schema, then re-check the
// parsed result against the Walkthrough schema, because the model's output format
// does not check it for us.

import type { StopReason, StreamEvent } from "@codethrough/model";
import { toJsonSchema, Walkthrough } from "@codethrough/schema";
import { parse, ValiError } from "valibot";

/**
 * The JSON schema the compose call targets. We hand it to the model; the model does
 * not check its own output against it, so compose re-checks the result.
 */
const walkthroughOutputSchema = (): Record<string, unknown> =>
  toJsonSchema(Walkthrough) as Record<string, unknown>;

/** The full compose output the batch path collects: the text and why it stopped. */
interface ComposeOutput {
  text: string;
  stopReason: StopReason;
}

/**
 * Collect the whole compose stream into the full text and the stop reason. The batch
 * path (compose.ts) joins the text deltas and reads the final stop reason; the
 * streaming path sends chunks as they arrive instead. No final event defaults to an
 * "other" stop (the real provider always sends one; this guards a buggy fake).
 */
const accumulateOutput = async (stream: AsyncIterable<StreamEvent>): Promise<ComposeOutput> => {
  const parts: string[] = [];
  let stopReason: StopReason = "other";
  for await (const event of stream) {
    if (event.type === "text") {
      parts.push(event.text);
    } else {
      ({ stopReason } = event);
    }
  }
  return { text: parts.join(""), stopReason };
};

/** Re-check a parsed object against the Walkthrough schema, or throw clearly. */
const validateWalkthrough = (parsed: unknown): Walkthrough => {
  try {
    return parse(Walkthrough, parsed);
  } catch (error) {
    // A schema mismatch gets a clear message; any other error (say a throwing
    // getter) is rethrown unchanged.
    if (!(error instanceof ValiError)) {
      throw error;
    }
    throw new Error(`compose returned an invalid walkthrough: ${error.message}`, { cause: error });
  }
};

/** Parse the collected output, or throw a clear "no parsed walkthrough" error. */
const parseOutputJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("compose returned no parsed walkthrough (structured output missing).", {
      cause: error,
    });
  }
};

/**
 * Read and re-check the walkthrough from the collected output, or throw.
 *
 * A refusal or a token-limit stop both mean there is no usable walkthrough (the
 * refusal made none; the token limit cut the JSON off), so we fail with a clear
 * message. Otherwise we parse the text and re-check it against the Walkthrough schema.
 */
const walkthroughFromOutput = (text: string, stopReason: StopReason): Walkthrough => {
  if (stopReason === "refusal" || stopReason === "max_tokens") {
    throw new Error(`compose stopped without a usable walkthrough: ${stopReason}`);
  }
  return validateWalkthrough(parseOutputJson(text));
};

export { accumulateOutput, validateWalkthrough, walkthroughFromOutput, walkthroughOutputSchema };
export type { ComposeOutput };
