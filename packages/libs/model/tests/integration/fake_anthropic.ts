// Fakes for the Anthropic SDK client, so the provider's two calls (the explore tool
// loop and the streaming compose) run in-process with no network. The fakes copy
// only the parts the provider actually uses.

import { once } from "node:events";

import type { Anthropic } from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta";
import type { Message, MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";

/** What the fake tool runner records so a test can check what was sent. */
interface ToolRunnerCapture {
  body?: unknown;
  signal?: AbortSignal | undefined;
}

/** What the fake compose stream records, for assertions. */
interface StreamCapture {
  body?: unknown;
  signal?: AbortSignal | undefined;
}

/** A text-only assistant message, the shape the brief join reads. */
const textMessage = (text: string, stopReason = "end_turn"): BetaMessage =>
  ({
    content: [{ type: "text", text, citations: null }],
    stop_reason: stopReason,
  }) as unknown as BetaMessage;

/** Reject as soon as `signal` cancels, like the SDK does. */
const throwOnAbort = async (signal: AbortSignal | undefined): Promise<never> => {
  if (signal && !signal.aborted) {
    await once(signal, "abort");
  }
  throw new Error("The operation was aborted");
};

/**
 * A fake client whose tool runner yields the given messages in order, then can
 * trigger a failure:
 * - `error` set: throws after all messages are yielded (a too-long prompt or other
 *   API error);
 * - `waitForAbort: true`: after yielding, waits for the signal and throws when it
 *   cancels.
 * The body and request options are recorded so a test can check what was sent.
 */
const fakeExploreClient = (opts: {
  messages: BetaMessage[];
  error?: unknown;
  waitForAbort?: boolean;
  capture?: ToolRunnerCapture;
}): Anthropic => {
  const toolRunner = (body: unknown, options?: { signal?: AbortSignal }) => {
    if (opts.capture) {
      opts.capture.body = body;
      opts.capture.signal = options?.signal;
    }
    return {
      async *[Symbol.asyncIterator]() {
        for (const message of opts.messages) {
          yield message;
        }
        if (opts.waitForAbort) {
          await throwOnAbort(options?.signal);
        }
        if (opts.error !== undefined) {
          throw opts.error;
        }
      },
    };
  };
  return { beta: { messages: { toolRunner } } } as unknown as Anthropic;
};

/** A stream event carrying one chunk of text. */
const textDeltaEvent = (text: string): MessageStreamEvent =>
  ({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  }) as MessageStreamEvent;

// Non-text events the real stream mixes in around the text deltas. The fake yields
// them too so we can check the provider ignores them.
const NON_TEXT_EVENTS: MessageStreamEvent[] = [
  { type: "content_block_start", index: 0 } as unknown as MessageStreamEvent,
  { type: "content_block_stop", index: 0 } as unknown as MessageStreamEvent,
];

/** The final message the fake stream resolves: stop reason and token usage. */
const finalMessageWith = (opts: {
  stopReason?: string | null;
  inputTokens?: number;
  outputTokens?: number;
}): Message =>
  ({
    stop_reason: "stopReason" in opts ? opts.stopReason : "end_turn",
    usage: { input_tokens: opts.inputTokens ?? 0, output_tokens: opts.outputTokens ?? 0 },
  }) as unknown as Message;

/**
 * A fake client whose stream returns a stream-like object: it iterates the scripted
 * text deltas and resolves the final message with the given stop reason and token
 * usage. The body and request options are recorded for assertions.
 */
const fakeComposeStreamClient = (opts: {
  deltas: string[];
  stopReason?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  capture?: StreamCapture;
}): Anthropic => {
  const stream = (body: unknown, options?: { signal?: AbortSignal }) => {
    if (opts.capture) {
      opts.capture.body = body;
      opts.capture.signal = options?.signal;
    }
    const usageOpts = {
      ...("stopReason" in opts ? { stopReason: opts.stopReason } : {}),
      ...(opts.inputTokens === undefined ? {} : { inputTokens: opts.inputTokens }),
      ...(opts.outputTokens === undefined ? {} : { outputTokens: opts.outputTokens }),
    };
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<MessageStreamEvent> {
        yield NON_TEXT_EVENTS[0]!;
        for (const text of opts.deltas) {
          yield textDeltaEvent(text);
        }
        yield NON_TEXT_EVENTS[1]!;
      },
      finalMessage: async (): Promise<Message> => finalMessageWith(usageOpts),
    };
  };
  return { messages: { stream } } as unknown as Anthropic;
};

export { fakeComposeStreamClient, fakeExploreClient, textMessage };
export type { StreamCapture, ToolRunnerCapture };
