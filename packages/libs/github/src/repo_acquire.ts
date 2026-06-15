// Get a local checkout at a PR's head commit for the explore sandbox.
//
// Two paths, both taking the command runner (and a small filesystem port for the
// temp dir) so the git calls can be tested with a fake and against a real repo:
//
//   prepareRepoFromClone: partial-clone a remote (no blobs, no checkout), fetch
//     just the head commit, then check it out. cleanup removes the temp dir,
//     since we created it.
//   prepareRepoFromLocal: resolve an existing clone, and check out the commit in
//     place if one is given. cleanup does nothing, since we did not create it.

import type { CommandRunner } from "./command.js";
import { resolveCommandRunner, resolveFileSystem } from "./runtime.js";

// The filesystem calls repo acquisition needs, passed in so the temp dir can be
// tested. Defaults use node:fs/promises.
interface FileSystem {
  // Make a unique temp dir from a prefix and return its path.
  mkdtemp: (prefix: string) => Promise<string>;
  // Remove a dir and its contents, ignoring a missing one.
  rm: (dir: string) => Promise<void>;
}

// The optionals allow `undefined` so a caller can forward its own optional deps
// straight through. resolveDeps fills in the real defaults.
interface RepoAcquireDeps {
  run?: CommandRunner | undefined;
  fs?: FileSystem | undefined;
}

interface ResolvedDeps {
  run: CommandRunner;
  fs: FileSystem;
}

const resolveDeps = (deps: RepoAcquireDeps): ResolvedDeps => ({
  run: resolveCommandRunner(deps.run),
  fs: resolveFileSystem(deps.fs),
});

// An acquired repo: its root, plus a cleanup that removes the checkout only when
// we created it.
interface AcquiredRepo {
  repoRoot: string;
  cleanup: () => Promise<void>;
}

// Argv builders, kept pure so the exact git calls can be asserted.

// Partial clone: skip blob contents (fetched on demand) and the checkout, so we
// can check out a specific commit next instead of the default branch.
const cloneArgv = (cloneUrl: string, dir: string): string[] => [
  "clone",
  "--filter=blob:none",
  "--no-checkout",
  cloneUrl,
  dir,
];

// Fetch just the head commit; the partial clone did not download it.
const fetchOidArgv = (dir: string, oid: string): string[] => [
  "-C",
  dir,
  "fetch",
  "--depth",
  "1",
  "origin",
  oid,
];

const checkoutArgv = (dir: string, oid: string): string[] => ["-C", dir, "checkout", oid];

const toplevelArgv = (path: string): string[] => ["-C", path, "rev-parse", "--show-toplevel"];

// Run git, throwing its stderr if it exits non-zero. The clone and fetch can
// print warnings on stderr while still exiting zero; those are fine.
const git = async (run: CommandRunner, args: string[], context: string): Promise<string> => {
  const res = await run("git", args);
  if (res.code !== 0) {
    const detail = res.stderr.trim() || res.stdout.trim() || "no output";
    throw new Error(`${context} failed: ${detail}`);
  }
  return res.stdout;
};

// Find the repo's root for a path, so a subdir or symlinked path still gives the
// real worktree top.
const resolveToplevel = async (run: CommandRunner, path: string): Promise<string> => {
  const out = await git(run, toplevelArgv(path), `not a git repository: ${path}`);
  return out.trim();
};

interface CloneArgs {
  cloneUrl: string;
  headRefOid: string;
  dir: string;
}

// Partial-clone a remote, then fetch and check out the head commit. git clone
// creates `dir`, and cleanup removes it.
const prepareRepoFromClone = async (
  deps: RepoAcquireDeps,
  args: CloneArgs,
): Promise<AcquiredRepo> => {
  const { run, fs } = resolveDeps(deps);
  await git(run, cloneArgv(args.cloneUrl, args.dir), "git clone");
  await git(run, fetchOidArgv(args.dir, args.headRefOid), "git fetch");
  await git(run, checkoutArgv(args.dir, args.headRefOid), "git checkout");
  const repoRoot = await resolveToplevel(run, args.dir);
  return { repoRoot, cleanup: () => fs.rm(args.dir) };
};

interface LocalArgs {
  repoPath: string;
  headRefOid?: string;
}

// Use an existing local clone. Check out the head commit in place if one is
// given, else leave the working tree as-is. cleanup does nothing: we did not
// create this directory and must never delete the user's repo.
const prepareRepoFromLocal = async (
  deps: RepoAcquireDeps,
  args: LocalArgs,
): Promise<AcquiredRepo> => {
  // No filesystem port needed; there is no temp dir to clean up.
  const run = resolveCommandRunner(deps.run);
  const repoRoot = await resolveToplevel(run, args.repoPath);
  if (args.headRefOid !== undefined) {
    await git(run, checkoutArgv(repoRoot, args.headRefOid), "git checkout");
  }
  // Nothing to clean up: we did not create this directory.
  return { repoRoot, cleanup: async () => {} };
};

export { prepareRepoFromClone, prepareRepoFromLocal };
export type { AcquiredRepo, CloneArgs, FileSystem, LocalArgs, RepoAcquireDeps };
