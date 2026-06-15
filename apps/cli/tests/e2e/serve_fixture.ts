// The e2e server entry: start the real server with fake review data and a fake
// walkthrough, serving the built frontend, on the e2e port. Playwright builds the
// frontend first, then runs this; the spec drives a browser to the page and checks
// the full <Review> UI loads. No GitHub, no Anthropic.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Comment, WalkthroughChunk } from "@codethrough/schema";

import { createReviewSource } from "../../src/server/review_source.js";
import { startServer } from "../../src/server/serve.js";
import { E2E_CHUNKS, E2E_CONTEXT, E2E_LIVE_COMMENT, E2E_REVIEW } from "./fixture_data.js";

// The port Playwright uses so its base URL matches; the default keeps a manual run
// working.
const DEFAULT_PORT = 4_178;
const port = Number(process.env["CODETHROUGH_E2E_PORT"] ?? DEFAULT_PORT);

// A fixed token. The browser reads it from the page, so the value only has to
// match what the server checks.
const token = "e2e-bearer-token-fixed-value-0000";

// A short poll interval so the e2e sees the live change quickly (the real default
// is much longer). A real timer, so the loop ticks once before the fetch.
const POLL_INTERVAL_MS = 250;

// The built frontend is two folders up from this file.
const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");

// The fake walkthrough: yield the fixture chunks with a tiny delay so the UI fills
// in chunk by chunk.
const runWalkthrough = (signal: AbortSignal): AsyncIterable<WalkthroughChunk> =>
  (async function* gen(): AsyncIterable<WalkthroughChunk> {
    for (const chunk of E2E_CHUNKS) {
      if (signal.aborted) {
        return;
      }
      yield chunk;
    }
  })();

// A real cancellable wait, so the loop waits one interval and the e2e sees the
// change arrive after the page loads. Races the signal against a timeout.
const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  // Bridging an abort event to a promise legitimately needs new Promise.
  // oxlint-disable-next-line promise/avoid-new
  new Promise((resolve) => {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(ms)]);
    combined.addEventListener("abort", () => resolve(), { once: true });
    if (combined.aborted) {
      resolve();
    }
  });

// The fake live fetch: the comments list has gained one comment, so the poller
// sends an "added" change the UI renders. Later polls return the same list.
const fetchComments = async (): Promise<Comment[]> =>
  await Promise.resolve([...E2E_REVIEW.comments, E2E_LIVE_COMMENT]);

// The fake submit: record nothing (the UI only needs the url) and return a fixed
// url so the submit control shows success.
const submit = async (): Promise<{ htmlUrl: string }> =>
  await Promise.resolve({ htmlUrl: "https://github.com/octo/demo/pull/7#pullrequestreview-1" });

const source = createReviewSource({
  data: E2E_REVIEW,
  context: E2E_CONTEXT,
  runWalkthrough,
  wait,
  intervalMs: POLL_INTERVAL_MS,
  submit,
  fetchComments,
});
const server = startServer({ source, distDir, port, token });

process.stdout.write(`e2e server listening on http://127.0.0.1:${server.port}\n`);
