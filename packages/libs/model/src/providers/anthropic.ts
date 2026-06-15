// The Anthropic provider: the only module that calls the SDK. It adapts the SDK to
// our model provider interface, so everything else stays SDK-free. The client is
// passed in, so tests can drive the whole thing with a fake and no network.
//
// This module pulls in the SDK helpers and types, so the rule that limits
// dependency count does not apply.
/* oxlint-disable import/max-dependencies */

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { BetaMessage, BetaTextBlock } from "@anthropic-ai/sdk/resources/beta";
import type { Message, MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";

import type { AnthropicCredential } from "../credential.js";
import type {
  ComposeRequest,
  ExploreRequest,
  ModelProvider,
  ModelTool,
  StopReason,
  StreamEvent,
} from "../port.js";
import { clientFor } from "../runtime.js";

/** How hard the model thinks. The subset of the SDK's effort levels we expose. */
type Effort = "low" | "high" | "max";

/** Options for building the provider: model, effort, credential, and client. */
interface AnthropicProviderOptions {
  model: string;
  effort: Effort;
  credential: AnthropicCredential;
  /** SDK client; tests pass a fake. Defaults to one built from the credential. */
  client?: Anthropic;
}

/** Join an assistant message's text blocks into one string. */
const briefFromMessage = (message: BetaMessage): string =>
  message.content
    .filter((block): block is BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

/** True for the API error meaning the prompt was too long for the context window. */
const isPromptTooLong = (error: unknown): boolean =>
  error instanceof Error && /prompt is too long/i.test(error.message);

/**
 * Wrap one of our tools as the SDK's tool type. The caller owns and validates the
 * input schema, so we cast it to the shape the helper wants, then forward `run` and
 * pass the SDK's abort signal through.
 */
const toBetaTool = (tool: ModelTool): BetaRunnableTool =>
  betaTool({
    name: tool.name,
    description: tool.description,
    // The caller owns and validates the schema, so just cast it to the shape the
    // helper wants.
    inputSchema: tool.inputSchema as { type: "object" },
    // Our run takes the args as `unknown` and validates them itself, so just pass
    // them straight through.
    run: (args, context) => tool.run(args, context?.signal ? { signal: context.signal } : {}),
  });

/**
 * Run the tool-use loop, keeping the latest assistant message. Hitting the
 * iteration cap ends cleanly, but a cancel throws and drops the in-flight reply, so
 * keeping the latest is the only way to save the brief. A cancel or a too-long
 * prompt is logged and swallowed; anything else is rethrown.
 */
const drainRunner = async (
  runner: AsyncIterable<BetaMessage>,
  signal: AbortSignal | undefined,
  log: ((message: string) => void) | undefined,
): Promise<BetaMessage | undefined> => {
  let latest: BetaMessage | undefined = undefined;
  try {
    for await (const message of runner) {
      latest = message;
    }
  } catch (error) {
    const aborted = signal?.aborted ?? false;
    if (!aborted && !isPromptTooLong(error)) {
      throw error;
    }
    const reason = aborted ? "the wall-clock bound" : "the context limit";
    log?.(`Exploration hit ${reason}; using the brief gathered so far.`);
  }
  return latest;
};

/** Map the SDK's stop reason onto our small, vendor-neutral set. */
const mapStopReason = (stopReason: Message["stop_reason"]): StopReason => {
  if (stopReason === "max_tokens") {
    return "max_tokens";
  }
  if (stopReason === "refusal") {
    return "refusal";
  }
  if (stopReason === "end_turn") {
    return "end";
  }
  return "other";
};

/** Pull the text out of a text-delta event, else "". */
const textOf = (event: MessageStreamEvent): string =>
  event.type === "content_block_delta" && event.delta.type === "text_delta" ? event.delta.text : "";

/**
 * The small slice of the SDK stream we use: iterate the events and await the final
 * message. Defining it here lets a fake client match exactly this much.
 */
interface StreamLike extends AsyncIterable<MessageStreamEvent> {
  finalMessage: () => Promise<Message>;
}

/** Run the SDK tool loop for one explore request and return the brief text. */
const runExplore =
  (client: Anthropic, model: string, effort: Effort) =>
  async (req: ExploreRequest): Promise<string> => {
    const runner = client.beta.messages.toolRunner(
      {
        model,
        max_tokens: req.maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort },
        max_iterations: req.maxIterations,
        tools: req.tools.map(toBetaTool),
        messages: [{ role: "user", content: req.prompt }],
      },
      req.signal ? { signal: req.signal } : {},
    );
    // Keep the latest message so a cancel mid-run still saves the brief so far.
    const latest = await drainRunner(runner as AsyncIterable<BetaMessage>, req.signal, req.log);
    return latest ? briefFromMessage(latest) : "";
  };

/** Stream the structured-output compose as our events. */
const runComposeStream = (client: Anthropic, model: string, effort: Effort) =>
  async function* composeStreamGen(req: ComposeRequest): AsyncIterable<StreamEvent> {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: req.maxTokens,
        thinking: { type: "adaptive" },
        output_config: {
          effort,
          format: jsonSchemaOutputFormat(req.outputSchema as never),
        },
        messages: [{ role: "user", content: req.prompt }],
      },
      req.signal ? { signal: req.signal } : undefined,
    ) as StreamLike;

    for await (const event of stream) {
      const text = textOf(event);
      if (text !== "") {
        yield { type: "text", text };
      }
    }
    const message = await stream.finalMessage();
    yield {
      type: "final",
      stopReason: mapStopReason(message.stop_reason),
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  };

/**
 * Build the Anthropic provider: explore runs the tool loop and returns the brief;
 * composeStream streams the structured-output call. Model and effort are fixed here,
 * so callers pass only prompts and budgets. The client is passed in for tests, else
 * built from the credential.
 */
const createAnthropicProvider = (opts: AnthropicProviderOptions): ModelProvider => {
  const client = opts.client ?? clientFor(opts.credential);
  return {
    modelId: opts.model,
    explore: runExplore(client, opts.model, opts.effort),
    composeStream: runComposeStream(client, opts.model, opts.effort),
  };
};

export { createAnthropicProvider };
export type { AnthropicProviderOptions, Effort };
