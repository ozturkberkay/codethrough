// Tests for orchestrateRun: it prepares the review, starts the server with the
// assembled source, opens the browser (unless --no-open), and shutdown stops the
// server and cleans up. The server start and browser open are fakes, so no socket.

import type { WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { parseRunArgs } from "../../src/args/run_args.js";
import type { WatchdogClock } from "../../src/run/idle_watchdog.js";
import { orchestrateRun, type OrchestrateDeps } from "../../src/run/orchestrate.js";
import type { PreparedIngest } from "../../src/run/prepare_review.js";
import type { StreamEngineFn } from "../../src/run/walkthrough_runner.js";
import type { RunningServer, ServeOptions } from "../../src/server/serve.js";
import { FIXTURE_REVIEW, noConfigLoader } from "../fixtures/review_fixture.js";

// A fake clock so the idle path runs with no real time.
interface FakeClock extends WatchdogClock<number> {
  advance: (ms: number) => void;
}

const makeClock = (): FakeClock => {
  let current = 0;
  let nextId = 1;
  let pending: { id: number; at: number; callback: () => void } | null = null;
  return {
    now: () => current,
    setTimer: (callback, delayMs) => {
      const id = nextId++;
      pending = { id, at: current + delayMs, callback };
      return id;
    },
    clearTimer: (handle) => {
      if (pending?.id === handle) {
        pending = null;
      }
    },
    advance: (ms) => {
      current += ms;
      while (pending !== null && pending.at <= current) {
        const due = pending;
        pending = null;
        due.callback();
      }
    },
  };
};

const fakeIngest = (cleanup: () => Promise<void> = async () => {}): PreparedIngest => ({
  meta: FIXTURE_REVIEW.meta,
  diffModel: FIXTURE_REVIEW.diff,
  rawDiff: FIXTURE_REVIEW.diff.rawDiff,
  repoRoot: "/repo",
  cleanup,
});

// A fake streaming engine that yields a minimal summary -> done sequence.
const fakeStreamEngine: StreamEngineFn = async function* gen(): AsyncIterable<WalkthroughChunk> {
  yield {
    type: "summary",
    summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d"] },
  };
  yield { type: "done" };
};

// A fake server handle that records its stop.
const fakeServer = (port: number, onStop: () => void): RunningServer => ({
  port,
  token: "tok",
  stop: onStop,
});

// A no-op clock for the tests that do not touch the idle path (they never advance
// it, so the timer never fires).
const inertClock: WatchdogClock<unknown> = {
  now: () => 0,
  setTimer: () => 0,
  clearTimer: () => {},
};

const makeDeps = (over: Partial<OrchestrateDeps> = {}): OrchestrateDeps => ({
  loadConfig: noConfigLoader,
  resolvePrAuth: async () => ({ token: "tok", viewer: null }),
  ingestPr: async () => fakeIngest(),
  loadComments: async () => [],
  submitReview: async () => ({ htmlUrl: "https://example.com/r/1" }),
  ingestLocal: async () => fakeIngest(),
  streamEngine: fakeStreamEngine,
  newSessionId: () => "s1",
  startServer: () => fakeServer(4_321, () => {}),
  openBrowser: () => {},
  port: 4_321,
  token: "bearer-tok",
  distDir: "/dist",
  // An immediate wait: the orchestrate tests do not exercise the poll cadence.
  wait: async () => {},
  idleClock: inertClock,
  ...over,
});

describe("orchestrateRun", () => {
  it("starts the server with the assembled source and opens the browser", async () => {
    const serveCalls: ServeOptions[] = [];
    const openedUrls: string[] = [];
    const deps = makeDeps({
      startServer: (options) => {
        serveCalls.push(options);
        return fakeServer(4_321, () => {});
      },
      openBrowser: (url) => {
        openedUrls.push(url);
      },
    });
    const run = await orchestrateRun(parseRunArgs(["."]), deps);

    const options = serveCalls[0]!;
    expect(options.port).toBe(4_321);
    expect(options.token).toBe("bearer-tok");
    expect(options.distDir).toBe("/dist");
    // The source serves the prepared review.
    expect(options.source.getReview().meta).toEqual(FIXTURE_REVIEW.meta);
    expect(openedUrls[0]).toBe("http://127.0.0.1:4321");
    expect(run.url).toBe("http://127.0.0.1:4321");
  });

  it("does not open the browser with --no-open", async () => {
    let opened = false;
    const deps = makeDeps({
      openBrowser: () => {
        opened = true;
      },
    });
    await orchestrateRun(parseRunArgs([".", "--no-open"]), deps);
    expect(opened).toBe(false);
  });

  it("shutdown stops the server and runs ingest cleanup", async () => {
    let stopped = false;
    let cleaned = false;
    const deps = makeDeps({
      ingestLocal: async () =>
        fakeIngest(async () => {
          cleaned = true;
        }),
      startServer: () =>
        fakeServer(4_321, () => {
          stopped = true;
        }),
    });
    const run = await orchestrateRun(parseRunArgs(["."]), deps);
    await run.shutdown();
    expect(stopped).toBe(true);
    expect(cleaned).toBe(true);
  });

  it("runs ingest cleanup when starting the server throws (no orphaned clone)", async () => {
    let cleaned = false;
    const deps = makeDeps({
      ingestLocal: async () =>
        fakeIngest(async () => {
          cleaned = true;
        }),
      startServer: () => {
        throw new Error("port lost its race");
      },
    });
    await expect(orchestrateRun(parseRunArgs(["."]), deps)).rejects.toThrow("port lost its race");
    // The clone the ingest created is removed even though shutdown was never wired.
    expect(cleaned).toBe(true);
  });

  it("resolves whenIdle after the idle window elapses, and an /api activity resets it", async () => {
    const clock = makeClock();
    let stopped = false;
    let cleaned = false;
    const activitySink: { fn: (() => void) | undefined } = { fn: undefined };
    const deps = makeDeps({
      idleClock: clock as WatchdogClock<unknown>,
      // The idle window comes from config (a project file here).
      loadConfig: (location) =>
        location === "project" ? { server: { idle_timeout_ms: 1_000 } } : undefined,
      ingestLocal: async () =>
        fakeIngest(async () => {
          cleaned = true;
        }),
      startServer: (options) => {
        activitySink.fn = options.onActivity;
        return fakeServer(4_321, () => {
          stopped = true;
        });
      },
    });
    const run = await orchestrateRun(parseRunArgs(["."]), deps);

    // A value that wins the race against whenIdle while it is still pending, so we
    // can check it has not resolved yet.
    const pending = Symbol("pending");
    const notYet = async (): Promise<typeof pending> => await Promise.resolve(pending);

    // An /api request at t=800 resets the deadline, so the old t=1000 passes without
    // firing.
    clock.advance(800);
    activitySink.fn?.();
    clock.advance(900);
    expect(await Promise.race([run.whenIdle, notYet()])).toBe(pending);

    // The new deadline at t=1800 fires; whenIdle resolves and the shell shuts down.
    clock.advance(100);
    await run.whenIdle;
    await run.shutdown();
    expect(stopped).toBe(true);
    expect(cleaned).toBe(true);
  });
});
