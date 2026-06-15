// The model provider interface, with no SDK types in it. Everything else depends
// only on these shapes; a provider adapts a real SDK to them. Supporting a new
// model vendor means adding one file that implements ModelProvider.

/**
 * One read-only tool the explore phase gives the model. `inputSchema` is a JSON
 * Schema; `run` gets the model's raw args (the caller validates them) and returns
 * the result text. The optional `signal` cuts off a slow call.
 */
interface ModelTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: unknown, ctx?: { signal?: AbortSignal }) => Promise<string>;
}

/**
 * One explore request: the first prompt, the read-only tools, and the loop limits.
 * `signal` cancels the whole phase; `log` is an optional place to report progress.
 */
interface ExploreRequest {
  prompt: string;
  tools: ModelTool[];
  maxIterations: number;
  maxTokens: number;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

/** Token counts a finished generation reports. */
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Why generation stopped, in vendor-neutral terms:
 *  - "end": finished normally;
 *  - "max_tokens": cut off at the token budget;
 *  - "refusal": the model declined;
 *  - "other": any other reason, treated like a normal finish.
 */
type StopReason = "end" | "max_tokens" | "refusal" | "other";

/**
 * One event from a streaming compose: a chunk of text, or the final event with the
 * stop reason and token usage.
 */
type StreamEvent =
  | { type: "text"; text: string }
  | { type: "final"; stopReason: StopReason; usage: TokenUsage };

/**
 * One compose request: the prompt, the JSON Schema the output must match, and the
 * token budget. `signal` cancels the request; `log` is an optional progress sink.
 */
interface ComposeRequest {
  prompt: string;
  outputSchema: Record<string, unknown>;
  maxTokens: number;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

/**
 * The swappable model provider. The caller owns the prompts, tools, parsing, and
 * pricing; the provider owns only the SDK call. `modelId` is exposed so the caller
 * can price the run.
 */
interface ModelProvider {
  readonly modelId: string;
  /** Run the tool-use loop and return the final brief text. */
  explore: (req: ExploreRequest) => Promise<string>;
  /** Stream the structured-output compose as events. */
  composeStream: (req: ComposeRequest) => AsyncIterable<StreamEvent>;
}

export type {
  ComposeRequest,
  ExploreRequest,
  ModelProvider,
  ModelTool,
  StopReason,
  StreamEvent,
  TokenUsage,
};
