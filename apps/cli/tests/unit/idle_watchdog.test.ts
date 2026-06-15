// Tests for the idle watchdog with a fake clock, so no real time passes: it fires
// after the idle window passes with no activity, a touch resets the deadline, and
// stop cancels it so it cannot fire during shutdown.

import { describe, expect, it } from "vitest";

import { createIdleWatchdog, type WatchdogClock } from "../../src/run/idle_watchdog.js";

// A fake clock: `advance` moves time forward and runs any timer that is now due.
// One pending timer at a time is enough for the watchdog.
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
      // Fire the timer if it is due; loop so a restarted timer that is also due
      // fires in the same step.
      while (pending !== null && pending.at <= current) {
        const due = pending;
        pending = null;
        due.callback();
      }
    },
  };
};

describe("createIdleWatchdog", () => {
  it("fires onIdle after the idle window elapses with no activity", () => {
    const clock = makeClock();
    let fired = 0;
    const watchdog = createIdleWatchdog({
      timeoutMs: 1_000,
      clock,
      onIdle: () => {
        fired += 1;
      },
    });
    watchdog.start();
    expect(fired).toBe(0);
    clock.advance(999);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
  });

  it("resets the deadline on activity (re-arms rather than fires)", () => {
    const clock = makeClock();
    let fired = 0;
    const watchdog = createIdleWatchdog({
      timeoutMs: 1_000,
      clock,
      onIdle: () => {
        fired += 1;
      },
    });
    watchdog.start();
    clock.advance(800);
    // Activity at t=800 moves the deadline to t=1800.
    watchdog.touch();
    // At t=1700 the old deadline has passed, but the timer restarted, so no fire.
    clock.advance(900);
    expect(fired).toBe(0);
    // At t=1800 the new deadline fires.
    clock.advance(100);
    expect(fired).toBe(1);
  });

  it("fires only once even past the deadline", () => {
    const clock = makeClock();
    let fired = 0;
    const watchdog = createIdleWatchdog({
      timeoutMs: 500,
      clock,
      onIdle: () => {
        fired += 1;
      },
    });
    watchdog.start();
    clock.advance(2_000);
    expect(fired).toBe(1);
  });

  it("does not fire after stop (shutdown already in progress)", () => {
    const clock = makeClock();
    let fired = 0;
    const watchdog = createIdleWatchdog({
      timeoutMs: 1_000,
      clock,
      onIdle: () => {
        fired += 1;
      },
    });
    watchdog.start();
    watchdog.stop();
    clock.advance(5_000);
    expect(fired).toBe(0);
  });

  it("ignores a touch after the action fired", () => {
    const clock = makeClock();
    let fired = 0;
    const watchdog = createIdleWatchdog({
      timeoutMs: 1_000,
      clock,
      onIdle: () => {
        fired += 1;
      },
    });
    watchdog.start();
    clock.advance(1_000);
    expect(fired).toBe(1);
    // A late touch must not re-arm a fired watchdog.
    watchdog.touch();
    clock.advance(5_000);
    expect(fired).toBe(1);
  });

  it("start is idempotent (a second start does not double-arm)", () => {
    const clock = makeClock();
    let fired = 0;
    const watchdog = createIdleWatchdog({
      timeoutMs: 1_000,
      clock,
      onIdle: () => {
        fired += 1;
      },
    });
    watchdog.start();
    watchdog.start();
    clock.advance(1_000);
    expect(fired).toBe(1);
  });
});
