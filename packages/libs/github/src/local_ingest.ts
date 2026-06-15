// Ingests a local repo for `codethrough run <path>`: a working tree or a
// base...head range, with no GitHub and no comments. A developer preview, so the
// meta is minimal and its GitHub-only fields are null.
//
// Git only. The command runner is passed in so this can be tested with a fake and
// against a real temp repo.

import type { DiffModel, ReviewMeta } from "@codethrough/schema";

import type { CommandRunner } from "./command.js";
import { buildDiffModel } from "./diff_model.js";
import { resolveCommandRunner } from "./runtime.js";

interface LocalIngestDeps {
  run?: CommandRunner;
}

// The revisions to diff. Both unset means the working tree against HEAD.
interface LocalRange {
  repoPath: string;
  base?: string;
  head?: string;
}

// What local ingest hands back: the meta, the raw diff and its model, the repo
// root, and a cleanup that does nothing (we created nothing).
interface LocalIngestResult {
  meta: ReviewMeta;
  rawDiff: string;
  diffModel: DiffModel;
  repoRoot: string;
  cleanup: () => Promise<void>;
}

// Title used when the head commit has no subject (e.g. an empty repo).
const PLACEHOLDER_TITLE = "Local changes";

// Ref label used when no head is given.
const WORKING_TREE_REF = "HEAD";

const toplevelArgv = (path: string): string[] => ["-C", path, "rev-parse", "--show-toplevel"];

const branchArgv = (root: string): string[] => ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"];

const subjectArgv = (root: string, rev: string): string[] => [
  "-C",
  root,
  "show",
  "-s",
  "--format=%s",
  rev,
];

// Diff a base...head range, or the working tree when no range is given.
const diffArgv = (root: string, base?: string, head?: string): string[] => {
  if (base !== undefined && head !== undefined) {
    return ["-C", root, "diff", `${base}...${head}`];
  }
  return ["-C", root, "diff"];
};

// Run git, throwing its stderr if it exits non-zero.
const git = async (run: CommandRunner, args: string[], context: string): Promise<string> => {
  const res = await run("git", args);
  if (res.code !== 0) {
    const detail = res.stderr.trim() || res.stdout.trim() || "no output";
    throw new Error(`${context} failed: ${detail}`);
  }
  return res.stdout;
};

// The head commit's subject, used as the title. Falls back to a placeholder when
// git prints nothing (e.g. a repo with no commits yet).
const headSubject = async (run: CommandRunner, root: string, head: string): Promise<string> => {
  const res = await run("git", subjectArgv(root, head));
  const subject = res.code === 0 ? res.stdout.trim() : "";
  return subject || PLACEHOLDER_TITLE;
};

// The current branch, used as the head ref when none is given. A detached HEAD
// prints "HEAD", which is fine as a label.
const currentBranch = async (run: CommandRunner, root: string): Promise<string> => {
  const res = await run("git", branchArgv(root));
  const branch = res.code === 0 ? res.stdout.trim() : "";
  return branch || WORKING_TREE_REF;
};

// Build the minimal meta. GitHub-only fields are null.
const buildLocalMeta = (title: string, baseRef: string, headRef: string): ReviewMeta => ({
  title,
  body: "",
  repoOwner: null,
  repoName: null,
  number: null,
  baseRef,
  headRef,
  author: null,
  url: null,
});

// Ingest a local repo into the same result shape PR ingest returns.
const ingestLocal = async (
  deps: LocalIngestDeps,
  range: LocalRange,
): Promise<LocalIngestResult> => {
  const run = resolveCommandRunner(deps.run);
  const toplevelOut = await git(run, toplevelArgv(range.repoPath), "not a git repository");
  const repoRoot = toplevelOut.trim();

  // Work out the ref labels and title, defaulting to the working tree.
  const headRef = range.head ?? (await currentBranch(run, repoRoot));
  const baseRef = range.base ?? WORKING_TREE_REF;
  const title = await headSubject(run, repoRoot, range.head ?? WORKING_TREE_REF);

  const rawDiff = await git(run, diffArgv(repoRoot, range.base, range.head), "git diff");
  return {
    meta: buildLocalMeta(title, baseRef, headRef),
    rawDiff,
    diffModel: buildDiffModel(rawDiff),
    repoRoot,
    // Nothing to clean up: we created nothing.
    cleanup: async () => {},
  };
};

export { ingestLocal };
export type { LocalIngestDeps, LocalIngestResult, LocalRange };
