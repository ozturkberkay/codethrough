// The real runtime parts the rest of the CLI injects: pick a free port, make the
// run's token and session id, open the browser, read the config files, build the
// GitHub client and auth flow, find the Anthropic credential and build the model
// provider, and wire the real engine and ingest. None of this works without a
// socket, a real keychain or network, or the OS, so it is kept here (not tested)
// and exercised by the integration and e2e tests and real use.
//
// It imports from many packages, so the dependency-count rule is off here.
/* oxlint-disable import/max-dependencies */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { streamEngine as engineStreamEngine } from "@codethrough/engine";
import {
  type AuthStatus,
  createGitHubClient,
  DeviceFlowClient,
  ingestLocal as ghIngestLocal,
  ingestPr as ghIngestPr,
  loadPlacedComments,
  logout as ghLogout,
  type ResolvedToken,
  resolveToken,
  selectStore,
  status as ghStatus,
  submitReview as ghSubmitReview,
  tryGhToken,
} from "@codethrough/github";
import {
  createAnthropicProvider,
  defaultCredentialDeps,
  resolveAnthropicCredential,
} from "@codethrough/model";
import type { Comment, CommentDraft, ReviewEvent } from "@codethrough/schema";

import type { AuthOps } from "./commands/auth.js";
import { createModelStreamEngine } from "./run/model.js";
import type { ConfigLoader } from "./run/resolve_run_config.js";
import type { WatchdogClock } from "./run/idle_watchdog.js";
import type { PrAuth, PreparedIngest } from "./run/prepare_review.js";

// The GitHub OAuth App client id for sign-in, taken from the env so an operator
// can set it without a rebuild.
const CLIENT_ID_ENV = "CODETHROUGH_GITHUB_CLIENT_ID";
// Optional override for the OAuth scope to request; the device flow defaults to
// `repo` when this is unset.
const SCOPES_ENV = "CODETHROUGH_GITHUB_SCOPES";

// Pick a free port by opening port 0, reading the port we got, and closing. A
// requested port is returned as-is. There is a small gap between closing and the
// server opening, but on loopback for one local user that is fine, and the server
// throws if it loses the race.
const pickPort = (requested: number | undefined): number => {
  if (requested !== undefined) {
    return requested;
  }
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } });
  const { port } = probe;
  probe.stop();
  return port;
};

// A random value for the run (the token or session id).
const randomId = (): string => crypto.randomUUID();

// The command to open a URL on this OS. Split out so openBrowser has no nested
// ternary.
const openArgv = (url: string): string[] => {
  if (process.platform === "darwin") {
    return ["open", url];
  }
  if (process.platform === "win32") {
    return ["cmd", "/c", "start", "", url];
  }
  return ["xdg-open", url];
};

// Open the URL in the default browser. Best-effort: a failure is fine since the
// URL is printed too, so errors are ignored.
const openBrowser = (url: string): void => {
  try {
    Bun.spawn(openArgv(url), { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  } catch {
    // Fine to ignore: the caller printed the URL too.
  }
};

// The path of a config file: the project file in the current directory, or the
// user file under the home config directory.
const configPath = (location: "project" | "user"): string =>
  location === "project"
    ? join(process.cwd(), ".codethrough.toml")
    : join(homedir(), ".config", "codethrough", "config.toml");

// Read and parse a config file, or undefined when it is absent or unreadable. A
// malformed file is treated as absent so the resolver uses the lower layers. The
// loader keeps only the keys it knows, so a token in the file is dropped, not read.
const parseTomlFile = (path: string): Record<string, unknown> | undefined => {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    // A malformed file is treated as absent.
    return undefined;
  }
};

const loadConfig: ConfigLoader = (location) => parseTomlFile(configPath(location));

// Build the auth deps (the token store and the sign-in client) shared by the auth
// commands and PR-mode sign-in.
const buildAuthDeps = async (): Promise<{
  store: Awaited<ReturnType<typeof selectStore>>;
  client: DeviceFlowClient;
}> => {
  const store = await selectStore();
  const clientId = process.env[CLIENT_ID_ENV] ?? "";
  const scope = process.env[SCOPES_ENV];
  const client = new DeviceFlowClient({
    clientId,
    // Pass the override only when set, so the client keeps its `repo` default.
    ...(scope ? { scope } : {}),
    onUserCode: (code) => {
      process.stdout.write(
        `To authenticate, open ${code.verification_uri} and enter code ${code.user_code}\n`,
      );
    },
  });
  return { store, client };
};

// Look up the viewer for a token (best-effort).
const viewerFor = (token: string): Promise<{ login: string }> =>
  createGitHubClient(token).getViewer();

// The auth operations behind `codethrough auth`, over the real store, sign-in, and
// gh reuse, with a best-effort viewer lookup.
const createAuthOps = async (): Promise<AuthOps> => {
  const { store, client } = await buildAuthDeps();
  const deps = { store, client, tryGh: tryGhToken, getViewer: viewerFor };
  return {
    login: (): Promise<ResolvedToken> => resolveToken(deps),
    logout: (): Promise<void> => ghLogout(store),
    status: (): Promise<AuthStatus> => ghStatus(deps),
  };
};

// Get a token and viewer for a PR run: reuse gh, the stored token, or sign-in,
// then look up the viewer (null on failure). The ref does not affect the token
// (it is account-wide), so it is unused.
const resolvePrAuth = async (_ref: {
  owner: string;
  repo: string;
  number: number;
}): Promise<PrAuth> => {
  const { store, client } = await buildAuthDeps();
  const resolved = await resolveToken({ store, client, tryGh: tryGhToken, getViewer: viewerFor });
  let viewer: { login: string } | null = null;
  try {
    viewer = await viewerFor(resolved.token);
  } catch {
    viewer = null;
  }
  return { token: resolved.token, viewer };
};

// Ingest a PR with the real GitHub client and real git/fs.
const ingestPr = async (args: {
  ref: { owner: string; repo: string; number: number };
  token: string;
  localRepoPath: string | undefined;
}): Promise<PreparedIngest> => {
  const { octokit } = createGitHubClient(args.token);
  // The real client matches the shape ingestPr needs (the github package proves it).
  const options = args.localRepoPath === undefined ? {} : { localRepoPath: args.localRepoPath };
  const result = await ghIngestPr(
    { octokit: octokit as unknown as Parameters<typeof ghIngestPr>[0]["octokit"] },
    { owner: args.ref.owner, repo: args.ref.repo, number: args.ref.number },
    options,
  );
  return {
    meta: result.meta,
    diffModel: result.diffModel,
    rawDiff: result.rawDiff,
    repoRoot: result.repoRoot,
    cleanup: result.cleanup,
  };
};

// Load and place the PR's review comments with the real GitHub client.
const loadComments = (args: {
  ref: { owner: string; repo: string; number: number };
  token: string;
  rawDiff: string;
}): Promise<Comment[]> => {
  const { octokit } = createGitHubClient(args.token);
  return loadPlacedComments(
    octokit as unknown as Parameters<typeof loadPlacedComments>[0],
    { owner: args.ref.owner, repo: args.ref.repo, prNumber: args.ref.number },
    args.rawDiff,
  );
};

// Submit one PR review with the real GitHub client. The stored drafts come from
// the server source; this just calls submitReview and returns the review's url.
const submitReview = async (args: {
  ref: { owner: string; repo: string; number: number };
  token: string;
  payload: { event: ReviewEvent; body?: string; comments?: CommentDraft[] };
}): Promise<{ htmlUrl: string }> => {
  const { octokit } = createGitHubClient(args.token);
  const result = await ghSubmitReview(
    octokit as unknown as Parameters<typeof ghSubmitReview>[0],
    args.ref,
    args.payload,
  );
  return { htmlUrl: result.htmlUrl };
};

// A cancellable wait for the comment poller: resolve after `ms`, or as soon as the
// signal aborts. The poll loop is tested with a fake wait, so this thin real one
// lives here. It races the signal against a timeout.
const pollWait = (ms: number, signal: AbortSignal): Promise<void> =>
  // Turning an abort event into a promise needs new Promise.
  // oxlint-disable-next-line promise/avoid-new
  new Promise((resolve) => {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(ms)]);
    combined.addEventListener("abort", () => resolve(), { once: true });
    // If it already aborted, the listener will not fire, so resolve now.
    if (combined.aborted) {
      resolve();
    }
  });

// Ingest a local path with the real git runner.
const ingestLocal = async (args: {
  repoPath: string;
  base?: string;
  head?: string;
}): Promise<PreparedIngest> => {
  const result = await ghIngestLocal({}, args);
  return {
    meta: result.meta,
    diffModel: result.diffModel,
    rawDiff: result.rawDiff,
    repoRoot: result.repoRoot,
    cleanup: result.cleanup,
  };
};

// The built frontend folder, found relative to this file so it works from the
// binary and from `bun run` alike.
const distDir = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

// The real idle clock: wall-clock now plus setTimeout/clearTimeout. Injected so the
// timer logic is tested with a fake clock. The handle is opaque across the boundary,
// so the real timer type is narrowed back here on clear.
const realIdleClock: WatchdogClock<unknown> = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// The engine the run wiring injects: find the real Anthropic credential, build the
// provider from the run's model and effort, and call the real engine. A missing
// credential errors clearly.
const streamEngine = createModelStreamEngine({
  resolveCredential: () => resolveAnthropicCredential(defaultCredentialDeps),
  createProvider: createAnthropicProvider,
  runEngineStream: engineStreamEngine,
});

export {
  createAuthOps,
  distDir,
  ingestLocal,
  ingestPr,
  loadComments,
  loadConfig,
  openBrowser,
  pickPort,
  pollWait,
  randomId,
  realIdleClock,
  resolvePrAuth,
  streamEngine,
  submitReview,
};
