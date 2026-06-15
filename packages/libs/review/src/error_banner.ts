// Maps each walkthrough failure to a plain-English title. Pure, so it is
// unit-tested. The banner shows this title above the raw error message.
import type { WalkthroughError } from "./walkthrough_stream.js";

// A short title for each kind of failure.
const TITLES: Record<WalkthroughError["kind"], string> = {
  refusal: "The model declined to produce this walkthrough.",
  max_tokens: "The walkthrough was cut off (token limit reached).",
  parse: "The model's output could not be parsed into a walkthrough.",
};

/** The human-readable title for a generation error's kind. */
const errorTitle = (kind: WalkthroughError["kind"]): string => TITLES[kind];

export { errorTitle };
