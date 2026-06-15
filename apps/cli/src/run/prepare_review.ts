// Prepare everything the server needs for one run: the review data, the session
// context, the walkthrough runner, and the cleanup. Every I/O helper is injected
// (auth, ingest, comment load, engine, config), so it is tested end to end with
// fakes and no real network, git, or Anthropic call.
//
//   PR mode:   resolve token, ingest the PR, load comments, build engine input
//   path mode: ingest locally (no GitHub, no comments), build engine input
//
// The Anthropic key and GitHub token live only here and below; the review data
// carries neither.
//
// It wires several helpers together, so the dependency-count rule is off here.
/* oxlint-disable import/max-dependencies */

import type { EngineConfig, EngineInput } from "@codethrough/engine";
import type {
  Comment,
  CommentDraft,
  ReviewContext,
  ReviewData,
  ReviewEvent,
} from "@codethrough/schema";

import type { RunArgs } from "../args/run_args.js";
import { optionalField } from "../optional.js";
import { buildReviewContext, buildReviewData, type IngestSlice } from "./review_data.js";
import { resolveRunConfig, type ConfigLoader } from "./resolve_run_config.js";
import { createWalkthroughRunner, type StreamEngineFn } from "./walkthrough_runner.js";
import type { FetchCommentsFn, SubmitFn, WalkthroughRunner } from "../server/review_source.js";

// One parsed PR reference, reused across the helpers below.
interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

// What an ingest (PR or path) gives back: the meta and diff (for the review data),
// the raw diff and repo root (for the engine), and a cleanup. A subset of both
// ingest result types, so either fits.
interface PreparedIngest extends IngestSlice {
  rawDiff: string;
  repoRoot: string;
  cleanup: () => Promise<void>;
}

// A resolved PR auth result: the token and the viewer login (best-effort).
interface PrAuth {
  token: string;
  viewer: { login: string } | null;
}

// The injected helpers. Each is a function so a test can use a fake with no real
// I/O. The engine matches the real streamEngine's shape.
interface PrepareReviewDeps {
  loadConfig: ConfigLoader;
  // PR mode: resolve a usable token and the viewer. The shell always provides it.
  resolvePrAuth: (ref: PrRef) => Promise<PrAuth>;
  ingestPr: (args: {
    ref: PrRef;
    token: string;
    localRepoPath: string | undefined;
  }) => Promise<PreparedIngest>;
  loadComments: (args: { ref: PrRef; token: string; rawDiff: string }) => Promise<Comment[]>;
  // PR mode: submit one review (the source passes the stored drafts through).
  // Returns the new review's url.
  submitReview: (args: {
    ref: PrRef;
    token: string;
    payload: { event: ReviewEvent; body?: string; comments?: CommentDraft[] };
  }) => Promise<{ htmlUrl: string }>;
  ingestLocal: (args: {
    repoPath: string;
    base?: string;
    head?: string;
  }) => Promise<PreparedIngest>;
  streamEngine: StreamEngineFn;
  newSessionId: () => string;
  log?: (message: string) => void;
}

// What a prepared run hands to the server. The write and live helpers are present
// in PR mode and absent in path mode, which decides whether comments are
// available. The server settings (idle window and poll interval) come from config.
interface PreparedReview {
  data: ReviewData;
  context: ReviewContext;
  runWalkthrough: WalkthroughRunner;
  cleanup: () => Promise<void>;
  idleTimeoutMs: number;
  commentPollMs: number;
  submit?: SubmitFn;
  fetchComments?: FetchCommentsFn;
}

// Build the engine input from the ingest.
const toEngineInput = (ingest: PreparedIngest): EngineInput => ({
  rawDiff: ingest.rawDiff,
  repoRoot: ingest.repoRoot,
  meta: {
    title: ingest.meta.title,
    body: ingest.meta.body,
    baseRef: ingest.meta.baseRef,
    headRef: ingest.meta.headRef,
  },
});

// What the write and live helpers need in PR mode: the ref and token. Absent in
// path mode, so the review has no submit or fetch.
interface PrBinding {
  ref: PrRef;
  token: string;
}

// Build the PR-mode write and live helpers: a submit that sends the drafts to
// GitHub, and a comment re-fetch the poller calls. Returned as optional fields so
// comments turn on only when both are present.
const prCollaborators = (
  binding: PrBinding,
  ingest: PreparedIngest,
  deps: PrepareReviewDeps,
): { submit: SubmitFn; fetchComments: FetchCommentsFn } => ({
  submit: (payload) => deps.submitReview({ ref: binding.ref, token: binding.token, payload }),
  fetchComments: () =>
    deps.loadComments({ ref: binding.ref, token: binding.token, rawDiff: ingest.rawDiff }),
});

// The review before the server settings are added (prepareReview adds those). The
// mode helpers build this.
type AssembledReview = Omit<PreparedReview, "idleTimeoutMs" | "commentPollMs">;

// Assemble the review from the ingest, comments, and context. `pr` is present in
// PR mode (to bind the write and live helpers) and absent in path mode.
const assemble = (args: {
  ingest: PreparedIngest;
  comments: Comment[];
  mode: "pr" | "path";
  sessionId: string;
  viewer: { login: string } | null;
  repo: { owner: string; name: string } | null;
  config: EngineConfig;
  deps: PrepareReviewDeps;
  pr?: PrBinding;
}): AssembledReview => {
  const inputs = {
    ingest: args.ingest,
    comments: args.comments,
    mode: args.mode,
    sessionId: args.sessionId,
    viewer: args.viewer,
    repo: args.repo,
  };
  const runWalkthrough = createWalkthroughRunner({
    streamEngine: args.deps.streamEngine,
    input: toEngineInput(args.ingest),
    config: args.config,
    ...optionalField("log", args.deps.log),
  });
  return {
    data: buildReviewData(inputs),
    context: buildReviewContext(inputs),
    runWalkthrough,
    cleanup: args.ingest.cleanup,
    ...(args.pr ? prCollaborators(args.pr, args.ingest, args.deps) : {}),
  };
};

// What the two mode helpers share, bundled so each stays within the parameter
// limit.
interface PrepareContext {
  args: RunArgs;
  config: EngineConfig;
  deps: PrepareReviewDeps;
}

// Run the steps after ingest, cleaning up on a throw. Once the ingest has made a
// (possibly temp) clone, a later failure must remove it. Cleanup runs before the
// rethrow and never hides the original error.
const withIngestCleanup = async <T>(
  ingest: PreparedIngest,
  steps: () => Promise<T>,
): Promise<T> => {
  try {
    return await steps();
  } catch (error) {
    await ingest.cleanup().catch(() => {
      // A cleanup failure must not hide the original error, which is rethrown below.
    });
    throw error;
  }
};

// Prepare a PR-mode run: auth, ingest, comments, then assemble. Steps after ingest
// are guarded so a throw removes the clone first.
const preparePr = async (context: PrepareContext, ref: PrRef): Promise<AssembledReview> => {
  const { args, config, deps } = context;
  const auth = await deps.resolvePrAuth(ref);
  const ingest = await deps.ingestPr({ ref, token: auth.token, localRepoPath: args.repo });
  return withIngestCleanup(ingest, async () => {
    const comments = await deps.loadComments({ ref, token: auth.token, rawDiff: ingest.rawDiff });
    return assemble({
      ingest,
      comments,
      mode: "pr",
      sessionId: deps.newSessionId(),
      viewer: auth.viewer,
      repo: { owner: ref.owner, name: ref.repo },
      config,
      deps,
      pr: { ref, token: auth.token },
    });
  });
};

// Prepare a path-mode run: local ingest only, no GitHub, no comments.
const preparePath = async (context: PrepareContext, path: string): Promise<AssembledReview> => {
  const { args, config, deps } = context;
  const ingest = await deps.ingestLocal({
    repoPath: args.repo ?? path,
    ...optionalField("base", args.base),
    ...optionalField("head", args.head),
  });
  return assemble({
    ingest,
    comments: [],
    mode: "path",
    sessionId: deps.newSessionId(),
    viewer: null,
    repo: null,
    config,
    deps,
  });
};

// Prepare the run, picking PR mode or path mode from the target. Config is
// resolved once: its engine part drives the runner, and its server settings (idle
// window and poll interval) ride along on the result.
const prepareReview = async (args: RunArgs, deps: PrepareReviewDeps): Promise<PreparedReview> => {
  const resolved = resolveRunConfig({ args, loadConfig: deps.loadConfig });
  const context: PrepareContext = { args, config: resolved.engine, deps };
  const prepared =
    args.target.kind === "pr"
      ? await preparePr(context, args.target.ref)
      : await preparePath(context, args.target.path);
  return {
    ...prepared,
    idleTimeoutMs: resolved.idleTimeoutMs,
    commentPollMs: resolved.commentPollMs,
  };
};

export { prepareReview, toEngineInput };
export type { PrAuth, PrepareReviewDeps, PreparedIngest, PreparedReview };
