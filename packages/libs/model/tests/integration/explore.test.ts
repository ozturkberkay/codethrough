// Tests for explore using a fake client, so the tool loop, the brief join, the
// cancel and too-long-prompt recovery, the tool wrapping, and the request body all
// run with no network.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnthropicCredential } from "../../src/credential.js";
import type { ExploreRequest, ModelTool } from "../../src/port.js";
import { createAnthropicProvider } from "../../src/providers/anthropic.js";
import { fakeExploreClient, textMessage, type ToolRunnerCapture } from "./fake_anthropic.js";

const OAUTH: AnthropicCredential = { kind: "oauth", token: "t" };

// A read tool whose run echoes back the args it got.
const echoTool = (received: { args?: unknown }): ModelTool => ({
  name: "read_file",
  description: "Read a file.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
  run: async (args) => {
    received.args = args;
    return "tool result";
  },
});

const request = (over: Partial<ExploreRequest> = {}): ExploreRequest => ({
  prompt: "explore the repo",
  tools: [],
  maxIterations: 30,
  maxTokens: 16_000,
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("anthropic provider: explore", () => {
  it("returns the brief from the final assistant message", async () => {
    const client = fakeExploreClient({
      messages: [textMessage("interim"), textMessage("final brief")],
    });
    const provider = createAnthropicProvider({
      model: "m",
      effort: "high",
      credential: OAUTH,
      client,
    });
    expect(await provider.explore(request())).toBe("final brief");
  });

  it("sends the model, effort, max_iterations, adaptive thinking, and the prompt", async () => {
    const capture: ToolRunnerCapture = {};
    const client = fakeExploreClient({ messages: [textMessage("ok")], capture });
    const provider = createAnthropicProvider({
      model: "claude-haiku-4-5",
      effort: "low",
      credential: OAUTH,
      client,
    });
    await provider.explore(request({ maxIterations: 12, maxTokens: 9_000 }));
    const body = capture.body as {
      model: string;
      max_tokens: number;
      max_iterations: number;
      thinking: { type: string };
      output_config: { effort: string };
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.max_tokens).toBe(9_000);
    expect(body.max_iterations).toBe(12);
    expect(body.thinking.type).toBe("adaptive");
    expect(body.output_config.effort).toBe("low");
    expect(body.messages[0]).toEqual({ role: "user", content: "explore the repo" });
  });

  it("forwards the abort signal into the tool runner's request options", async () => {
    const capture: ToolRunnerCapture = {};
    const controller = new AbortController();
    const client = fakeExploreClient({ messages: [textMessage("ok")], capture });
    const provider = createAnthropicProvider({
      model: "m",
      effort: "high",
      credential: OAUTH,
      client,
    });
    await provider.explore(request({ signal: controller.signal }));
    expect(capture.signal).toBe(controller.signal);
  });

  it("wraps a port tool as a runnable betaTool whose run executes the body", async () => {
    const received: { args?: unknown } = {};
    const capture: ToolRunnerCapture = {};
    const client = fakeExploreClient({ messages: [textMessage("ok")], capture });
    const provider = createAnthropicProvider({
      model: "m",
      effort: "high",
      credential: OAUTH,
      client,
    });
    await provider.explore(request({ tools: [echoTool(received)] }));
    // The wrapped tool has name, parse, and run, and run passes the parsed args to
    // our tool body.
    const { tools } = capture.body as {
      tools: {
        name: string;
        parse: (i: unknown) => unknown;
        run: (a: unknown) => Promise<string>;
      }[];
    };
    expect(tools[0]!.name).toBe("read_file");
    const parsed = tools[0]!.parse({ path: "a.ts" });
    expect(await tools[0]!.run(parsed)).toBe("tool result");
    expect(received.args).toEqual({ path: "a.ts" });
  });

  it("forwards the SDK tool-run abort signal into the port tool's ctx", async () => {
    const seen: { signal: AbortSignal | undefined } = { signal: undefined };
    const tool: ModelTool = {
      name: "grep",
      description: "Search.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async (_args, ctx) => {
        seen.signal = ctx?.signal;
        return "ok";
      },
    };
    const capture: ToolRunnerCapture = {};
    const client = fakeExploreClient({ messages: [textMessage("ok")], capture });
    const provider = createAnthropicProvider({
      model: "m",
      effort: "high",
      credential: OAUTH,
      client,
    });
    await provider.explore(request({ tools: [tool] }));
    const { tools: built } = capture.body as {
      tools: { run: (a: unknown, c?: { signal?: AbortSignal }) => Promise<string> }[];
    };
    const signal = AbortSignal.abort();
    await built[0]!.run({}, { signal });
    // The SDK's tool-run signal is passed into our tool.
    expect(seen.signal).toBe(signal);
  });

  it("recovers from a context-limit 400 and uses the brief gathered so far", async () => {
    const logs: string[] = [];
    const client = fakeExploreClient({
      messages: [textMessage("partial brief")],
      error: new Error("prompt is too long: 250000 > 200000 tokens"),
    });
    const provider = createAnthropicProvider({
      model: "m",
      effort: "high",
      credential: OAUTH,
      client,
    });
    const brief = await provider.explore(request({ log: (m) => logs.push(m) }));
    expect(brief).toBe("partial brief");
    expect(logs.some((l) => /context limit/.test(l))).toBe(true);
  });

  it("recovers from a wall-clock abort and reports it", async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const controller = new AbortController();
    const client = fakeExploreClient({
      messages: [textMessage("brief before abort")],
      waitForAbort: true,
    });
    const provider = createAnthropicProvider({
      model: "m",
      effort: "high",
      credential: OAUTH,
      client,
    });
    const promise = provider.explore(
      request({ signal: controller.signal, log: (m) => logs.push(m) }),
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.runAllTimersAsync();
    const brief = await promise;
    expect(brief).toBe("brief before abort");
    expect(logs.some((l) => /wall-clock bound/.test(l))).toBe(true);
  });

  it("rethrows an unexpected error that is neither abort nor context-limit", async () => {
    const client = fakeExploreClient({ messages: [], error: new Error("some other API failure") });
    const provider = createAnthropicProvider({
      model: "m",
      effort: "high",
      credential: OAUTH,
      client,
    });
    await expect(provider.explore(request())).rejects.toThrow(/some other API failure/);
  });

  it("returns an empty brief when no message was ever yielded", async () => {
    const client = fakeExploreClient({ messages: [] });
    const provider = createAnthropicProvider({
      model: "m",
      effort: "high",
      credential: OAUTH,
      client,
    });
    expect(await provider.explore(request())).toBe("");
  });
});
