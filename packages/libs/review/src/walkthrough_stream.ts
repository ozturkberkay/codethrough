// Folds the walkthrough stream into one growing state, plus the loop that feeds
// the stream through it. The fold is pure, so it is unit-tested.
import type { ReviewDataSource, Step, Summary, WalkthroughChunk } from "@codethrough/schema";

// Where the walkthrough is: still streaming, finished, or failed.
type WalkthroughStatus = "streaming" | "done" | "error";

// A walkthrough failure and its message.
interface WalkthroughError {
  kind: "refusal" | "max_tokens" | "parse";
  message: string;
}

// Token counts and estimated cost.
interface WalkthroughUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// Everything the UI shows about the walkthrough so far: summary, steps, status,
// and the optional error and usage.
interface WalkthroughState {
  summary: Summary | null;
  steps: Step[];
  status: WalkthroughStatus;
  error: WalkthroughError | null;
  usage: WalkthroughUsage | null;
}

// The starting state, before any chunk arrives.
const initialWalkthroughState = (): WalkthroughState => ({
  summary: null,
  steps: [],
  status: "streaming",
  error: null,
  usage: null,
});

// Add a step, keeping the list in order. Steps usually arrive in order, so this
// sort is just in case.
const insertStep = (steps: Step[], incoming: Step): Step[] =>
  [...steps, incoming].sort((a, b) => a.order - b.order);

// Fold one chunk into the state and return the new state. Unknown chunk types are
// ignored so a new kind cannot crash the UI.
const reduceWalkthrough = (state: WalkthroughState, chunk: WalkthroughChunk): WalkthroughState => {
  switch (chunk.type) {
    case "summary": {
      return { ...state, summary: chunk.summary };
    }
    case "step": {
      return { ...state, steps: insertStep(state.steps, chunk.step) };
    }
    case "error": {
      return { ...state, status: "error", error: { kind: chunk.kind, message: chunk.message } };
    }
    case "usage": {
      return {
        ...state,
        usage: {
          inputTokens: chunk.inputTokens,
          outputTokens: chunk.outputTokens,
          costUsd: chunk.costUsd,
        },
      };
    }
    case "done": {
      return { ...state, status: "done" };
    }
    default: {
      return state;
    }
  }
};

// Stream the walkthrough chunks, folding each one and reporting the new state.
// Reports the starting state first, so the "generating" view shows right away.
const consumeWalkthrough = async (
  source: ReviewDataSource,
  jobId: string,
  onState: (state: WalkthroughState) => void,
): Promise<WalkthroughState> => {
  let state = initialWalkthroughState();
  onState(state);
  for await (const chunk of source.streamWalkthrough(jobId)) {
    state = reduceWalkthrough(state, chunk);
    onState(state);
  }
  return state;
};

export { consumeWalkthrough, initialWalkthroughState, reduceWalkthrough };
export type { WalkthroughError, WalkthroughState, WalkthroughStatus, WalkthroughUsage };
