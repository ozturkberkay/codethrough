// Polls for new comments. Webhooks cannot reach a local server, so we re-fetch
// the comments on a timer, compare each result to the last, and send only the
// changes. The frontend merges them in.
//
// The wait and the fetch are both injected and cancelling is a signal, so the
// whole loop is tested with no real timers or network.

import type { Comment, CommentDelta } from "@codethrough/schema";

import { diffCommentLists, isEmptyDelta } from "./comment_delta.js";

// A cancellable sleep: resolve after `ms`, or as soon as the signal aborts. The
// real one uses a timer; tests inject a controllable one.
type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

// The inputs for one poll loop. `initial` is the list the first fetch is compared
// against (the comments already served), so a change since startup shows up on the
// first tick.
interface PollDeps {
  initial: Comment[];
  fetchComments: () => Promise<Comment[]>;
  wait: Wait;
  intervalMs: number;
  signal: AbortSignal;
}

// Yield each non-empty change on the timer until the signal aborts. Each tick:
// wait one interval, fetch the comments, compare to the last list, yield the
// change when there is one, then remember the new list. A failed fetch ends the
// loop; the stream route wraps this so a hiccup does not crash the server.
const pollCommentDeltas = async function* pollCommentDeltasGen(
  deps: PollDeps,
): AsyncIterable<CommentDelta> {
  let previous = deps.initial;
  while (!deps.signal.aborted) {
    // Each tick waits for the one before it, so awaiting in the loop is intended.
    // oxlint-disable-next-line no-await-in-loop
    await deps.wait(deps.intervalMs, deps.signal);
    if (deps.signal.aborted) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop
    const next = await deps.fetchComments();
    const delta = diffCommentLists(previous, next);
    previous = next;
    if (!isEmptyDelta(delta)) {
      yield delta;
    }
  }
};

export { pollCommentDeltas };
export type { PollDeps, Wait };
