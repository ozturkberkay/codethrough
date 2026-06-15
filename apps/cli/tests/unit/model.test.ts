// Tests for createModelStreamEngine: the part that finds the Anthropic credential,
// builds a provider, and calls the real engine. Driven by fakes, so the
// no-credential error, the expired note, the provider build, and passing the log
// and signal through all run with no network.

import type { EngineConfig, EngineInput } from "@codethrough/engine";
import type { AnthropicCredential, ModelProvider } from "@codethrough/model";
import type { WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import {
  createModelStreamEngine,
  type EngineRun,
  type ModelEngineDeps,
  NO_CREDENTIAL_MESSAGE,
  type ProviderFactory,
} from "../../src/run/model.js";

const INPUT: EngineInput = {
  rawDiff: "",
  repoRoot: "/repo",
  meta: { title: "t", body: "b", baseRef: "main", headRef: "feature" },
};

const CONFIG: EngineConfig = {
  model: "claude-opus-4-8",
  effort: "high",
  maxHunks: 60,
  compose: { maxTokens: 64_000 },
  explore: {
    maxTokens: 16_000,
    maxIterations: 30,
    phaseTimeoutMs: 600_000,
    toolTimeoutMs: 15_000,
    maxFileBytes: 65_536,
    maxMatches: 200,
  },
  catalog: { maxHunkRows: 400, maxTotalRows: 6_000, maxTotalChars: 400_000 },
};

// A stub provider; the fake engine never calls it.
const STUB_PROVIDER = { modelId: "stub" } as unknown as ModelProvider;

// Records what the fake engine was called with, and yields one done chunk.
interface EngineCall {
  config?: EngineConfig;
  deps?: { provider: ModelProvider; log?: (m: string) => void; signal?: AbortSignal };
}

const fakeEngine = (call: EngineCall): EngineRun =>
  async function* gen(_input, config, deps): AsyncIterable<WalkthroughChunk> {
    call.config = config;
    call.deps = deps;
    yield { type: "done" };
  };

// Records the provider-factory args, returns the stub provider.
interface FactoryCall {
  args?: { model: string; effort: EngineConfig["effort"]; credential: AnthropicCredential };
}

const fakeFactory =
  (call: FactoryCall): ProviderFactory =>
  (args) => {
    call.args = args;
    return STUB_PROVIDER;
  };

const drain = async (stream: AsyncIterable<WalkthroughChunk>): Promise<WalkthroughChunk[]> => {
  const out: WalkthroughChunk[] = [];
  for await (const chunk of stream) {
    out.push(chunk);
  }
  return out;
};

// Build the deps with sane defaults; each test overrides what it exercises.
const makeDeps = (over: Partial<ModelEngineDeps> = {}): ModelEngineDeps => ({
  resolveCredential: () => ({ kind: "apiKey", apiKey: "sk-ant-api" }),
  createProvider: () => STUB_PROVIDER,
  runEngineStream: () => (async function* g(): AsyncIterable<WalkthroughChunk> {})(),
  ...over,
});

describe("createModelStreamEngine", () => {
  it("throws a clear, actionable error when no credential resolves", async () => {
    const engine = createModelStreamEngine(makeDeps({ resolveCredential: () => null }));
    // The throw happens synchronously when the stream is created.
    expect(() => engine(INPUT, CONFIG)).toThrow(NO_CREDENTIAL_MESSAGE);
  });

  it("names every accepted credential source in the error message", () => {
    expect(NO_CREDENTIAL_MESSAGE).toMatch(/ANTHROPIC_API_KEY/);
    expect(NO_CREDENTIAL_MESSAGE).toMatch(/Claude CLI/);
    expect(NO_CREDENTIAL_MESSAGE).toMatch(/subscription/i);
  });

  it("builds a provider from the run's model + effort and the resolved credential", async () => {
    const factoryCall: FactoryCall = {};
    const credential: AnthropicCredential = { kind: "oauth", token: "tok" };
    const engine = createModelStreamEngine(
      makeDeps({
        resolveCredential: () => credential,
        createProvider: fakeFactory(factoryCall),
      }),
    );
    await drain(engine(INPUT, { ...CONFIG, model: "claude-haiku-4-5", effort: "low" }));
    expect(factoryCall.args).toEqual({
      model: "claude-haiku-4-5",
      effort: "low",
      credential,
    });
  });

  it("delegates to the real engine with the built provider injected", async () => {
    const engineCall: EngineCall = {};
    const engine = createModelStreamEngine(
      makeDeps({ createProvider: () => STUB_PROVIDER, runEngineStream: fakeEngine(engineCall) }),
    );
    const chunks = await drain(engine(INPUT, CONFIG));
    expect(chunks).toEqual([{ type: "done" }]);
    expect(engineCall.deps?.provider).toBe(STUB_PROVIDER);
    expect(engineCall.config).toEqual(CONFIG);
  });

  it("threads the log and signal into the engine call when provided", async () => {
    const engineCall: EngineCall = {};
    const controller = new AbortController();
    const log = (): void => {};
    const engine = createModelStreamEngine(makeDeps({ runEngineStream: fakeEngine(engineCall) }));
    await drain(engine(INPUT, CONFIG, { log, signal: controller.signal }));
    expect(engineCall.deps?.log).toBe(log);
    expect(engineCall.deps?.signal).toBe(controller.signal);
  });

  it("omits the log and signal from the engine call when not provided", async () => {
    const engineCall: EngineCall = {};
    const engine = createModelStreamEngine(makeDeps({ runEngineStream: fakeEngine(engineCall) }));
    await drain(engine(INPUT, CONFIG));
    expect(engineCall.deps).not.toHaveProperty("log");
    expect(engineCall.deps).not.toHaveProperty("signal");
  });

  it("logs a refresh note for an expired oauth credential but still proceeds", async () => {
    const logs: string[] = [];
    const engineCall: EngineCall = {};
    const engine = createModelStreamEngine(
      makeDeps({
        resolveCredential: () => ({ kind: "oauth", token: "stale", expired: true }),
        runEngineStream: fakeEngine(engineCall),
      }),
    );
    const chunks = await drain(engine(INPUT, CONFIG, { log: (m) => logs.push(m) }));
    expect(logs.some((l) => /expired.*run `claude`/i.test(l))).toBe(true);
    // The run still proceeds with the (possibly still-valid) token.
    expect(chunks).toEqual([{ type: "done" }]);
  });

  it("does not log a refresh note for a fresh oauth credential", async () => {
    const logs: string[] = [];
    const engine = createModelStreamEngine(
      makeDeps({ resolveCredential: () => ({ kind: "oauth", token: "fresh" }) }),
    );
    await drain(engine(INPUT, CONFIG, { log: (m) => logs.push(m) }));
    expect(logs.some((l) => /expired/i.test(l))).toBe(false);
  });
});
