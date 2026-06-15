// The frontend's data source, talking to the local server over HTTP and streams.
//
// It reads the run's token from the page and sends it on every request, including
// the streams. We read the streams with fetch instead of EventSource, because
// EventSource cannot send our token and the server requires it on every route.
//
// fetch is injected so this is tested against a fake server.
//
// It uses most of the schema, so the dependency-count rule is off here.
/* oxlint-disable import/max-dependencies */

import { array, type GenericSchema, parse } from "valibot";
import {
  type CommentDeltaListener,
  type CommentDraft,
  type ReviewContext,
  ReviewData,
  type ReviewDataSource,
  type ReviewEvent,
  Comment as CommentSchema,
  CommentDraft as CommentDraftSchema,
  type WalkthroughChunk,
} from "@codethrough/schema";

import { createCommentDeltaParser } from "./sse_parse.js";
import { readSseStream, readSseStreamWith } from "./sse_stream.js";

// The config the server puts in the page. The token gates every call; apiBase is
// the API root (usually empty for relative URLs). mode, capabilities, and context
// come from the server so the UI shows the right write controls without a failed
// request first.
interface Bootstrap {
  token: string;
  apiBase: string;
  mode: "pr" | "path";
  capabilities: { comments: boolean };
  context: {
    sessionId: string;
    repo: { owner: string; name: string } | null;
    viewer: { login: string } | null;
  };
}

// What this needs: the page config and a fetch. The context and capabilities come
// from the config, not separate args, so there is one source of truth. fetch is
// injected so it can be tested with a fake server.
interface HttpSourceDeps {
  bootstrap: Bootstrap;
  fetchImpl?: typeof fetch;
}

// Pull the context the UI reads (mode, session, repo, viewer) out of the config.
const contextFromBootstrap = (bootstrap: Bootstrap): ReviewContext => ({
  sessionId: bootstrap.context.sessionId,
  mode: bootstrap.mode,
  viewer: bootstrap.context.viewer,
  repo: bootstrap.context.repo,
});

// What the request helpers share: the fetch, the API base, the auth header, and
// one abort controller per running job.
interface HttpClient {
  fetchImpl: typeof fetch;
  base: string;
  authHeaders: Record<string, string>;
  controllers: Map<string, AbortController>;
}

// Schema for the comments list response.
const CommentList = array(CommentSchema);

// Schema for the drafts list response.
const DraftList = array(CommentDraftSchema);

// The walkthrough path for a job (used by stream and cancel).
const walkthroughPath = (base: string, jobId: string): string =>
  `${base}/api/walkthrough?jobId=${encodeURIComponent(jobId)}`;

// GET a path with the auth header and check the JSON body against a schema.
const getJson = async <S extends GenericSchema>(
  client: HttpClient,
  path: string,
  schema: S,
): Promise<ReturnType<typeof parse<S>>> => {
  const response = await client.fetchImpl(`${client.base}${path}`, { headers: client.authHeaders });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: HTTP ${response.status}`);
  }
  return parse(schema, await response.json());
};

// POST a JSON body with the auth header; throw on a non-ok status. Returns the
// parsed response body.
const postJson = async (client: HttpClient, path: string, body: unknown): Promise<unknown> => {
  const response = await client.fetchImpl(`${client.base}${path}`, {
    method: "POST",
    headers: { ...client.authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed: HTTP ${response.status}`);
  }
  return response.json();
};

// POST to start a walkthrough job and return its id.
const postStart = async (client: HttpClient): Promise<{ jobId: string }> => {
  const response = await client.fetchImpl(`${client.base}/api/walkthrough`, {
    method: "POST",
    headers: client.authHeaders,
  });
  if (!response.ok) {
    throw new Error(`start walkthrough failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { jobId: string };
  return { jobId: body.jobId };
};

// Stream the walkthrough with fetch. The job's controller is stored so cancel can
// abort this fetch.
const streamJob = (client: HttpClient, jobId: string): AsyncIterable<WalkthroughChunk> => {
  const controller = new AbortController();
  client.controllers.set(jobId, controller);
  return (async function* streamGen(): AsyncIterable<WalkthroughChunk> {
    try {
      const response = await client.fetchImpl(walkthroughPath(client.base, jobId), {
        headers: client.authHeaders,
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) {
        throw new Error(`stream walkthrough failed: HTTP ${response.status}`);
      }
      yield* readSseStream(response.body, controller.signal);
    } finally {
      client.controllers.delete(jobId);
    }
  })();
};

// Cancel a running stream: abort its fetch, then tell the server to stop the job.
// A missing controller (already done) just skips the abort.
const cancelJob = async (client: HttpClient, jobId: string): Promise<void> => {
  client.controllers.get(jobId)?.abort();
  client.controllers.delete(jobId);
  await client.fetchImpl(walkthroughPath(client.base, jobId), {
    method: "DELETE",
    headers: client.authHeaders,
  });
};

// Draft a comment: POST it to the store. The server checks it (a 400 becomes a
// thrown error here).
const draftComment = async (client: HttpClient, draft: CommentDraft): Promise<void> => {
  await postJson(client, "/api/comments/draft", draft);
};

// Submit one review; the server attaches the stored drafts. A non-ok status throws.
const submitReview = async (
  client: HttpClient,
  review: { event: ReviewEvent; body?: string },
): Promise<void> => {
  await postJson(client, "/api/review/submit", review);
};

// Subscribe to the live comment stream: open it with the auth header, parse each
// change, and pass it to `onDelta`. Returns an unsubscribe that closes the stream.
// The loop runs in the background and ignores errors, since a closed stream just
// stops sending changes and the UI keeps what it has.
const subscribeComments = (client: HttpClient, onDelta: CommentDeltaListener): (() => void) => {
  const controller = new AbortController();
  // Errors are ignored here: a closed or failed stream just stops sending, and the
  // UI keeps its last comments. Nothing is re-thrown, so the call below needs no catch.
  const consume = async (): Promise<void> => {
    try {
      const response = await client.fetchImpl(`${client.base}/api/comments/stream`, {
        headers: client.authHeaders,
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) {
        return;
      }
      const parser = createCommentDeltaParser();
      for await (const delta of readSseStreamWith(response.body, parser, controller.signal)) {
        onDelta(delta);
      }
    } catch {
      // A closed or failed stream just stops; the UI keeps its last comments.
    }
  };
  // Run the loop in the background; unsubscribe aborts it.
  void consume();
  return () => controller.abort();
};

const createHttpReviewDataSource = (deps: HttpSourceDeps): ReviewDataSource => {
  const client: HttpClient = {
    // The default fetch is bound to globalThis. Stored on an object and called as a
    // method, a bare `fetch` would lose its `this` and the browser would throw.
    fetchImpl: deps.fetchImpl ?? globalThis.fetch.bind(globalThis),
    base: deps.bootstrap.apiBase,
    authHeaders: { Authorization: `Bearer ${deps.bootstrap.token}` },
    controllers: new Map(),
  };

  return {
    // Context and capabilities come from the page config the server set. In
    // local-path mode comments is false, so the UI shows the "unavailable"
    // fallback instead of a composer that would fail.
    context: contextFromBootstrap(deps.bootstrap),
    getReview: () => getJson(client, "/api/review", ReviewData),
    listComments: () => getJson(client, "/api/comments", CommentList),
    startWalkthrough: () => postStart(client),
    streamWalkthrough: (jobId) => streamJob(client, jobId),
    cancelWalkthrough: (jobId) => cancelJob(client, jobId),
    listDrafts: () => getJson(client, "/api/drafts", DraftList),
    draftComment: (draft) => draftComment(client, draft),
    submitReview: (review) => submitReview(client, review),
    subscribeComments: (onDelta) => subscribeComments(client, onDelta),
    capabilities: { comments: deps.bootstrap.capabilities.comments },
  };
};

export { createHttpReviewDataSource };
export type { Bootstrap, HttpSourceDeps };
