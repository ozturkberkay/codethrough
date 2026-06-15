// The real partial-clone and checkout path against a local fixture repo, offline.
// We init a repo, commit two files, capture the head commit, then clone from the
// local path and check the checkout holds the right files.
//
// The unit tests cover the logic; this proves the real git calls. Skipped if git
// is missing.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prepareRepoFromClone, prepareRepoFromLocal } from "../../src/repo_acquire.js";

const hasGit = (): boolean => spawnSync("git", ["--version"]).status === 0;

// Hermetic git env: ignore the user's global/system config (so a custom identity,
// gpgsign, or hooks cannot leak in or slow these throwaway repos) and set a fixed
// identity, which also drops the two `git config` calls the fixture used to make.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "tester",
  GIT_AUTHOR_EMAIL: "t@t.dev",
  GIT_COMMITTER_NAME: "tester",
  GIT_COMMITTER_EMAIL: "t@t.dev",
};

// Run git in a dir, failing loudly if it errors so a broken fixture is obvious.
// `core.fsync=none` skips the disk syncs these throwaway commits do not need.
const git = (cwd: string, ...args: string[]): string => {
  const res = spawnSync("git", ["-C", cwd, "-c", "core.fsync=none", ...args], {
    encoding: "utf8",
    env: GIT_ENV,
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout;
};

interface Fixture {
  root: string;
  originPath: string;
  headOid: string;
  baseOid: string;
}

// Build a local origin repo with two commits; return its path and both commits.
const buildFixture = (): Fixture => {
  const root = mkdtempSync(join(tmpdir(), "ct-repo-acquire-"));
  const originPath = join(root, "origin");
  spawnSync("git", ["init", "-q", "-b", "main", originPath], { env: GIT_ENV });
  writeFileSync(join(originPath, "a.txt"), "alpha\n");
  git(originPath, "add", "a.txt");
  git(originPath, "commit", "-q", "-m", "first");
  const baseOid = git(originPath, "rev-parse", "HEAD").trim();
  writeFileSync(join(originPath, "b.txt"), "bravo\n");
  git(originPath, "add", "b.txt");
  git(originPath, "commit", "-q", "-m", "second");
  const headOid = git(originPath, "rev-parse", "HEAD").trim();
  return { root, originPath, headOid, baseOid };
};

// One shared origin fixture for the whole file, built once. Every test is
// effectively read-only on it: the clones fetch by oid, and the in-place checkout
// only detaches origin HEAD, which clones-by-oid ignore, so a per-test rebuild was
// pure overhead. The holder stays empty when git is missing so the skipped suite
// builds nothing.
const fixtureHolder: { value?: Fixture } = {};

beforeAll(() => {
  if (hasGit()) {
    fixtureHolder.value = buildFixture();
  }
});

afterAll(() => {
  if (fixtureHolder.value) {
    rmSync(fixtureHolder.value.root, { recursive: true, force: true });
  }
});

// The body borrows the shared fixture; kept as a wrapper so the tests read unchanged.
const withFixture = async (body: (f: Fixture) => Promise<void>): Promise<void> => {
  if (fixtureHolder.value === undefined) {
    throw new Error("fixture was not built");
  }
  await body(fixtureHolder.value);
};

describe.skipIf(!hasGit())("prepareRepoFromClone (REAL git, offline)", () => {
  it("partial-clones a local repo and checks out the head oid", async () => {
    await withFixture(async (fixture) => {
      const dir = await mkdtemp(join(tmpdir(), "ct-clone-dst-"));
      const repo = await prepareRepoFromClone(
        {},
        { cloneUrl: fixture.originPath, headRefOid: fixture.headOid, dir },
      );

      // The checkout sits at the head commit with both files present.
      expect(git(repo.repoRoot, "rev-parse", "HEAD").trim()).toBe(fixture.headOid);
      expect(existsSync(join(repo.repoRoot, "a.txt"))).toBe(true);
      expect(existsSync(join(repo.repoRoot, "b.txt"))).toBe(true);
      expect(readFileSync(join(repo.repoRoot, "b.txt"), "utf8")).toBe("bravo\n");

      // Cleanup removes the dir we created.
      await repo.cleanup();
      expect(existsSync(dir)).toBe(false);
    });
  });

  it("can check out an earlier (base) oid, proving fetch-by-oid is real", async () => {
    await withFixture(async (fixture) => {
      const dir = await mkdtemp(join(tmpdir(), "ct-clone-base-"));
      const repo = await prepareRepoFromClone(
        {},
        { cloneUrl: fixture.originPath, headRefOid: fixture.baseOid, dir },
      );

      // At the base commit, only the first file exists.
      expect(git(repo.repoRoot, "rev-parse", "HEAD").trim()).toBe(fixture.baseOid);
      expect(existsSync(join(repo.repoRoot, "a.txt"))).toBe(true);
      expect(existsSync(join(repo.repoRoot, "b.txt"))).toBe(false);

      await repo.cleanup();
      expect(existsSync(dir)).toBe(false);
    });
  });
});

describe.skipIf(!hasGit())("prepareRepoFromLocal (REAL git, offline)", () => {
  it("resolves the toplevel and checks out an oid in place", async () => {
    await withFixture(async (fixture) => {
      const repo = await prepareRepoFromLocal(
        {},
        { repoPath: fixture.originPath, headRefOid: fixture.baseOid },
      );

      // The root may be symlink-resolved (/private on macOS), so check the files
      // rather than the raw fixture path.
      expect(git(repo.repoRoot, "rev-parse", "HEAD").trim()).toBe(fixture.baseOid);
      expect(existsSync(join(repo.repoRoot, "b.txt"))).toBe(false);

      // Cleanup never removes the user's repo.
      await repo.cleanup();
      expect(existsSync(fixture.originPath)).toBe(true);
    });
  });
});
