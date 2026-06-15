// Run the `run` command: prepare the review, build the server source, start the
// server, and open the browser. The server starter and browser opener are
// injected so this is tested with fakes; the real ones live in the runtime shell.
//
// Returns the server handle plus a shutdown() that stops the server and cleans up
// the temp clone. The top-level shell waits for a signal around this; the idle
// timer resolves whenIdle so an unattended server shuts down the same way.
//
// It wires several pieces together, so the dependency-count rule is off here.
/* oxlint-disable import/max-dependencies */

import type { Wait } from "../server/comment_poller.js";
import { createReviewSource } from "../server/review_source.js";
import type { RunningServer, ServeOptions } from "../server/serve.js";
import { optionalField } from "../optional.js";
import type { RunArgs } from "../args/run_args.js";
import { createIdleWatchdog, type IdleWatchdog, type WatchdogClock } from "./idle_watchdog.js";
import { prepareReview, type PrepareReviewDeps, type PreparedReview } from "./prepare_review.js";

// The injected server starter (the real one opens the socket).
type StartServerFn = (options: ServeOptions) => RunningServer;

// The injected browser opener (the real one runs the OS open command).
type OpenBrowserFn = (url: string) => void;

// Everything orchestrateRun needs: the prepare-review helpers plus the
// server/browser edges and this run's port and token.
interface OrchestrateDeps extends PrepareReviewDeps {
  startServer: StartServerFn;
  openBrowser: OpenBrowserFn;
  // The chosen free port and this run's token.
  port: number;
  token: string;
  // The built frontend folder the server serves.
  distDir: string;
  // The cancellable wait for the comment poller; the interval comes from config.
  wait: Wait;
  // The idle clock and timer; injected so the timer is tested with no real waiting.
  // The idle window comes from config.
  idleClock: WatchdogClock<unknown>;
}

// A running run: the server handle, a shutdown that stops it and cleans up, and a
// whenIdle that resolves when the idle timer fires, so the shell can shut down the
// same way for an idle timeout as for Ctrl-C.
interface RunningRun {
  server: RunningServer;
  url: string;
  shutdown: () => Promise<void>;
  whenIdle: Promise<void>;
}

// Build the idle timer plus the promise that resolves when it fires. The timer
// resets on each /api request; when it fires it resolves whenIdle so the shell
// runs the shared shutdown.
const buildIdleWatchdog = (
  deps: OrchestrateDeps,
  idleTimeoutMs: number,
): { watchdog: IdleWatchdog; whenIdle: Promise<void> } => {
  let signalIdle = (): void => {};
  // Turning the timer's callback into a promise needs new Promise.
  // oxlint-disable-next-line promise/avoid-new
  const whenIdle = new Promise<void>((resolve) => {
    signalIdle = resolve;
  });
  const watchdog = createIdleWatchdog({
    timeoutMs: idleTimeoutMs,
    clock: deps.idleClock,
    onIdle: () => signalIdle(),
  });
  return { watchdog, whenIdle };
};

// Build the source and start the server. Split out so a throw in either step (like
// a port that lost its race) can clean up the temp clone before shutdown is wired.
// onActivity resets the idle timer on each /api request.
const startForPrepared = (
  prepared: PreparedReview,
  deps: OrchestrateDeps,
  onActivity: () => void,
): RunningServer => {
  const source = createReviewSource({
    data: prepared.data,
    context: prepared.context,
    runWalkthrough: prepared.runWalkthrough,
    wait: deps.wait,
    intervalMs: prepared.commentPollMs,
    // PR mode has the write and live helpers; path mode leaves them off, so the
    // source reports comments as unavailable.
    ...optionalField("submit", prepared.submit),
    ...optionalField("fetchComments", prepared.fetchComments),
  });
  return deps.startServer({
    source,
    distDir: deps.distDir,
    port: deps.port,
    token: deps.token,
    onActivity,
  });
};

// Start the server, cleaning up the temp clone if the start throws. Split out so
// orchestrateRun can assign `server` as a const.
const startOrCleanup = async (
  prepared: PreparedReview,
  deps: OrchestrateDeps,
  watchdog: IdleWatchdog,
): Promise<RunningServer> => {
  try {
    return startForPrepared(prepared, deps, () => watchdog.touch());
  } catch (error) {
    watchdog.stop();
    await prepared.cleanup().catch(() => {
      // A cleanup failure must not hide the start error; rethrow the original.
    });
    throw error;
  }
};

// Run the whole thing: prepare the review, start the server, open the browser
// (unless --no-open), and return the handle plus a shutdown. If the server start
// throws, the temp clone is still cleaned up.
const orchestrateRun = async (args: RunArgs, deps: OrchestrateDeps): Promise<RunningRun> => {
  const prepared = await prepareReview(args, deps);
  const { watchdog, whenIdle } = buildIdleWatchdog(deps, prepared.idleTimeoutMs);

  const server = await startOrCleanup(prepared, deps, watchdog);
  // Start the idle timer now the server is live; each /api request resets it.
  watchdog.start();

  const url = `http://127.0.0.1:${server.port}`;
  if (args.open) {
    deps.openBrowser(url);
  }

  return {
    server,
    url,
    whenIdle,
    shutdown: async () => {
      // Stop the timer first so it cannot fire during shutdown.
      watchdog.stop();
      server.stop();
      await prepared.cleanup();
    },
  };
};

export { orchestrateRun };
export type { OpenBrowserFn, OrchestrateDeps, RunningRun, StartServerFn };
