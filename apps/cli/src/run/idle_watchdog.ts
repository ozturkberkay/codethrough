// Shuts the server down after it sits idle too long (it also stops on Ctrl-C). It
// tracks the last activity time (the server calls touch() on each /api request)
// and fires onIdle once the idle window passes with nothing happening. The clock
// and timer are injected so it is tested with no real waiting.
//
// Each activity resets the deadline. If the timer fires but there was activity
// since it was set, it reschedules for the time left instead of firing, so one
// timer is enough and nothing is missed.
//
// The idle window is passed in from config; this holds no default.

// The injected clock and timer, so this is testable without real time. `now`
// returns the current time in ms; `setTimer` runs a callback once after a delay
// and returns a handle `clearTimer` cancels.
interface WatchdogClock<H> {
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => H;
  clearTimer: (handle: H) => void;
}

// What it needs: the idle window, the clock and timer, and the idle action (the
// shared shutdown that stops the server and cleans up).
interface IdleWatchdogDeps<H> {
  timeoutMs: number;
  clock: WatchdogClock<H>;
  onIdle: () => void;
}

// The handle: touch records activity (resetting the deadline); start begins it;
// stop cancels it so shutdown cannot re-fire it.
interface IdleWatchdog {
  touch: () => void;
  start: () => void;
  stop: () => void;
}

// The mutable state, passed to the helpers below so the factory stays small.
interface WatchdogState<H> {
  deps: IdleWatchdogDeps<H>;
  lastActivity: number;
  handle: H | null;
  fired: boolean;
}

// Cancel any pending timer.
const clearPending = <H>(state: WatchdogState<H>): void => {
  if (state.handle !== null) {
    state.deps.clock.clearTimer(state.handle);
    state.handle = null;
  }
};

// Start a timer for the time left until the deadline (at least 0).
const arm = <H>(state: WatchdogState<H>): void => {
  const { clock } = state.deps;
  const remaining = Math.max(0, state.lastActivity + state.deps.timeoutMs - clock.now());
  state.handle = clock.setTimer(() => onFire(state), remaining);
};

// When the timer fires: if there was activity since it started, the deadline
// moved, so restart for the time left; otherwise the window passed, so fire the
// idle action once.
const onFire = <H>(state: WatchdogState<H>): void => {
  state.handle = null;
  if (state.fired) {
    return;
  }
  if (state.deps.clock.now() < state.lastActivity + state.deps.timeoutMs) {
    arm(state);
    return;
  }
  state.fired = true;
  state.deps.onIdle();
};

const createIdleWatchdog = <H>(deps: IdleWatchdogDeps<H>): IdleWatchdog => {
  const state: WatchdogState<H> = {
    deps,
    lastActivity: deps.clock.now(),
    handle: null,
    fired: false,
  };
  return {
    // Ignore activity after the action fired (the server is shutting down);
    // otherwise record it so the next firing uses the new deadline.
    touch: () => {
      if (!state.fired) {
        state.lastActivity = deps.clock.now();
      }
    },
    start: () => {
      if (state.handle === null && !state.fired) {
        arm(state);
      }
    },
    stop: () => {
      state.fired = true;
      clearPending(state);
    },
  };
};

export { createIdleWatchdog };
export type { IdleWatchdog, IdleWatchdogDeps, WatchdogClock };
