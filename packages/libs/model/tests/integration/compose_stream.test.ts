// Tests for composeStream using a fake streaming client, so the text-to-event
// mapping, the final event, the request body, and the cancel plumbing all run with
// no network.

import type { Anthropic } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { AnthropicCredential } from "../../src/credential.js";
import type { ComposeRequest, StreamEvent } from "../../src/port.js";
import { createAnthropicProvider } from "../../src/providers/anthropic.js";
import { fakeComposeStreamClient, type StreamCapture } from "./fake_anthropic.js";

const OAUTH: AnthropicCredential = { kind: "oauth", token: "t" };

const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } } } as Record<
  string,
  unknown
>;

const request = (over: Partial<ComposeRequest> = {}): ComposeRequest => ({
  prompt: "compose the walkthrough",
  outputSchema: SCHEMA,
  maxTokens: 64_000,
  ...over,
});

const collect = async (it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> => {
  const out: StreamEvent[] = [];
  for await (const event of it) {
    out.push(event);
  }
  return out;
};

const provider = (client: Anthropic) =>
  createAnthropicProvider({ model: "claude-opus-4-8", effort: "high", credential: OAUTH, client });

describe("anthropic provider: composeStream", () => {
  it("yields a text event per delta, then a final event with usage + stop reason", async () => {
    const client = fakeComposeStreamClient({
      deltas: ['{"ok"', ":true}"],
      inputTokens: 1_000,
      outputTokens: 200,
    });
    const events = await collect(provider(client).composeStream(request()));
    expect(events).toEqual([
      { type: "text", text: '{"ok"' },
      { type: "text", text: ":true}" },
      { type: "final", stopReason: "end", usage: { inputTokens: 1_000, outputTokens: 200 } },
    ]);
  });

  it("skips non-text lifecycle events (only text deltas become text events)", async () => {
    // The fake mixes non-text events in around the deltas; those must not show up
    // as text events.
    const client = fakeComposeStreamClient({ deltas: ["a", "", "b"] });
    const events = await collect(provider(client).composeStream(request()));
    const texts = events.filter(
      (e): e is Extract<StreamEvent, { type: "text" }> => e.type === "text",
    );
    // The empty delta yields no event; the two non-empty ones do.
    expect(texts.map((t) => t.text)).toEqual(["a", "b"]);
  });

  it("sends the model, effort, adaptive thinking, and the json_schema output format", async () => {
    const capture: StreamCapture = {};
    const client = fakeComposeStreamClient({ deltas: ["{}"], capture });
    await collect(provider(client).composeStream(request()));
    const body = capture.body as {
      model: string;
      max_tokens: number;
      thinking: { type: string };
      output_config: { effort: string; format: { type: string; schema: { type: string } } };
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("claude-opus-4-8");
    expect(body.max_tokens).toBe(64_000);
    expect(body.thinking.type).toBe("adaptive");
    expect(body.output_config.effort).toBe("high");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.type).toBe("object");
    expect(body.messages[0]).toEqual({ role: "user", content: "compose the walkthrough" });
  });

  it("maps stop_reason max_tokens to the port's max_tokens", async () => {
    const client = fakeComposeStreamClient({ deltas: ["{}"], stopReason: "max_tokens" });
    const events = await collect(provider(client).composeStream(request()));
    expect(events.at(-1)).toMatchObject({ type: "final", stopReason: "max_tokens" });
  });

  it("maps stop_reason refusal to the port's refusal", async () => {
    const client = fakeComposeStreamClient({ deltas: [], stopReason: "refusal" });
    const events = await collect(provider(client).composeStream(request()));
    expect(events).toEqual([
      { type: "final", stopReason: "refusal", usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  });

  it("maps an unrecognized stop_reason to other", async () => {
    const client = fakeComposeStreamClient({ deltas: ["{}"], stopReason: "pause_turn" });
    const events = await collect(provider(client).composeStream(request()));
    expect(events.at(-1)).toMatchObject({ type: "final", stopReason: "other" });
  });

  it("maps a null stop_reason to other", async () => {
    const client = fakeComposeStreamClient({ deltas: ["{}"], stopReason: null });
    const events = await collect(provider(client).composeStream(request()));
    expect(events.at(-1)).toMatchObject({ type: "final", stopReason: "other" });
  });

  it("forwards the abort signal into messages.stream's request options", async () => {
    const capture: StreamCapture = {};
    const controller = new AbortController();
    const client = fakeComposeStreamClient({ deltas: ["{}"], capture });
    await collect(provider(client).composeStream(request({ signal: controller.signal })));
    expect(capture.signal).toBe(controller.signal);
  });

  it("omits the request options entirely when no signal is given", async () => {
    const capture: StreamCapture = {};
    const client = fakeComposeStreamClient({ deltas: ["{}"], capture });
    await collect(provider(client).composeStream(request()));
    expect(capture.signal).toBeUndefined();
  });

  it("surfaces the model id used for pricing", () => {
    const client = fakeComposeStreamClient({ deltas: ["{}"] });
    expect(provider(client).modelId).toBe("claude-opus-4-8");
  });
});
