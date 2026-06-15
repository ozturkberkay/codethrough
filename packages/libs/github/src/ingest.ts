// Ingests a PR for `codethrough run <pr-url>`.
//
// Fetches the PR metadata and diff, builds the DiffModel, and gets a local
// checkout at the head commit: an existing local clone if the CLI found one, else
// a partial clone in a temp dir that is cleaned up on exit. Returns what the CLI
// feeds the engine.

import { buildDiffModel } from "./diff_model.js";
import { fetchPrDiff, fetchPrMeta, type PrPullsClient } from "./pr_ingest.js";
import type { PrRef } from "./pr_url.js";
import {
  prepareRepoFromClone,
  prepareRepoFromLocal,
  type RepoAcquireDeps,
} from "./repo_acquire.js";
import { resolveFileSystem } from "./runtime.js";

// What ingest needs: the Octokit client for the metadata and diff, plus the git
// and filesystem deps for getting the repo. All passed in for tests.
type IngestDeps = RepoAcquireDeps & {
  octokit: PrPullsClient;
};

// Prefix for the partial-clone temp dir.
const CLONE_DIR_PREFIX = "codethrough-clone-";

// Where to get the repo: an existing local clone the CLI matched, or (when unset)
// a fresh partial clone.
interface IngestOptions {
  localRepoPath?: string;
}

// What PR ingest hands back to the CLI. The meta and diffModel types come from
// their producing functions, so we do not re-import the schema types.
interface IngestResult {
  meta: Awaited<ReturnType<typeof fetchPrMeta>>["meta"];
  rawDiff: string;
  diffModel: ReturnType<typeof buildDiffModel>;
  headRefOid: string;
  repoRoot: string;
  cleanup: () => Promise<void>;
}

// The arguments acquireRepo needs, bundled to keep its parameter count down.
interface AcquireArgs {
  deps: IngestDeps;
  ref: PrRef;
  headRefOid: string;
  localRepoPath: string | undefined;
}

// The public HTTPS clone URL for a PR's repo. The URL holds no token; git gets
// auth for private repos from the OS credential helper.
const cloneUrlFor = (ref: PrRef): string => `https://github.com/${ref.owner}/${ref.repo}.git`;

// Get the repo at the head commit: an existing local clone if the CLI matched
// one, else a partial clone in a fresh temp dir (which cleanup removes).
const acquireRepo = async (args: AcquireArgs): ReturnType<typeof prepareRepoFromClone> => {
  const { deps, ref, headRefOid, localRepoPath } = args;
  const repoDeps: RepoAcquireDeps = { run: deps.run, fs: deps.fs };
  if (localRepoPath !== undefined) {
    return prepareRepoFromLocal(repoDeps, { repoPath: localRepoPath, headRefOid });
  }
  const dir = await resolveFileSystem(deps.fs).mkdtemp(CLONE_DIR_PREFIX);
  return prepareRepoFromClone(repoDeps, { cloneUrl: cloneUrlFor(ref), headRefOid, dir });
};

// Ingest one PR into the CLI's result shape.
const ingestPr = async (
  deps: IngestDeps,
  ref: PrRef,
  options: IngestOptions = {},
): Promise<IngestResult> => {
  const { meta, headRefOid } = await fetchPrMeta(deps.octokit, ref);
  const rawDiff = await fetchPrDiff(deps.octokit, ref);
  const repo = await acquireRepo({ deps, ref, headRefOid, localRepoPath: options.localRepoPath });
  return {
    meta,
    rawDiff,
    diffModel: buildDiffModel(rawDiff),
    headRefOid,
    repoRoot: repo.repoRoot,
    cleanup: repo.cleanup,
  };
};

export { cloneUrlFor, ingestPr };
export type { IngestDeps, IngestOptions, IngestResult };
