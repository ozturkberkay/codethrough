// A fake provider so the engine phases (explore, compose, the streaming pipeline,
// stop-reason handling, abort, error paths) run in-process with no network. explore
// returns a scripted brief; composeStream yields scripted events. The requests are
// saved so a test can check what the engine sent.

import { once } from "node:events";

import type {
  ComposeRequest,
  ExploreRequest,
  ModelProvider,
  StopReason,
  StreamEvent,
} from "@codethrough/model";

/** Saves the explore request the engine built (for checks). */
interface ExploreCapture {
  request?: ExploreRequest;
}

/** Saves the compose request the engine built (for checks). */
interface ComposeCapture {
  request?: ComposeRequest;
}

/** Split text into `parts` even chunks (to show the reader handles any split). */
const splitEvenly = (text: string, parts: number): string[] => {
  const size = Math.ceil(text.length / parts);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
};

/** Build the final stream event from a stop reason and token counts. */
const finalEvent = (opts: {
  stopReason?: StopReason;
  inputTokens?: number;
  outputTokens?: number;
}): StreamEvent => ({
  type: "final",
  stopReason: opts.stopReason ?? "end",
  usage: { inputTokens: opts.inputTokens ?? 0, outputTokens: opts.outputTokens ?? 0 },
});

/**
 * Options for the fake provider. `brief` is what explore() returns (or it throws
 * `exploreError`); `deltas` are the compose text chunks, then a final event built from
 * `stopReason` and the token counts. `abortAware` stops the compose stream as soon as
 * the signal aborts, calling `onDelta` for each chunk.
 */
interface FakeProviderOptions {
  modelId?: string;
  brief?: string;
  exploreError?: unknown;
  // When set, explore() waits on the signal before returning the brief, so a test can
  // drive the engine's time limit (which aborts that signal).
  exploreWaitsForAbort?: boolean;
  deltas?: string[];
  stopReason?: StopReason;
  inputTokens?: number;
  outputTokens?: number;
  abortAware?: boolean;
  onDelta?: (delta: string) => void;
  exploreCapture?: ExploreCapture;
  composeCapture?: ComposeCapture;
}

/**
 * A fake provider: explore() returns the scripted brief (or throws), and
 * composeStream() yields each scripted text chunk then a final event. Covers only the
 * part of the provider the engine uses.
 */
const fakeProvider = (opts: FakeProviderOptions = {}): ModelProvider => ({
  modelId: opts.modelId ?? "claude-opus-4-8",
  explore: async (req: ExploreRequest): Promise<string> => {
    if (opts.exploreCapture) {
      opts.exploreCapture.request = req;
    }
    if (opts.exploreError !== undefined) {
      throw opts.exploreError;
    }
    // Act like a provider that returns the brief so far when the time limit hits: wait
    // for the signal to abort, then return (does not throw).
    if (opts.exploreWaitsForAbort && req.signal && !req.signal.aborted) {
      await once(req.signal, "abort");
    }
    return opts.brief ?? "";
  },
  composeStream: async function* composeStreamGen(req: ComposeRequest): AsyncIterable<StreamEvent> {
    if (opts.composeCapture) {
      opts.composeCapture.request = req;
    }
    for (const text of opts.deltas ?? []) {
      if (opts.abortAware && req.signal?.aborted) {
        return;
      }
      opts.onDelta?.(text);
      yield { type: "text", text };
    }
    yield finalEvent({
      ...(opts.stopReason === undefined ? {} : { stopReason: opts.stopReason }),
      ...(opts.inputTokens === undefined ? {} : { inputTokens: opts.inputTokens }),
      ...(opts.outputTokens === undefined ? {} : { outputTokens: opts.outputTokens }),
    });
  },
});

export { fakeProvider, finalEvent, splitEvenly };
export type { ComposeCapture, ExploreCapture, FakeProviderOptions };
