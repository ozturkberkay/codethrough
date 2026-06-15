// Real local ingest against a real temp git repo, offline. We build a base commit
// and a head commit that adds a line and a file, run ingestLocal over the range,
// and check the diff, the diff model, and the meta.
//
// The unit tests cover the logic; this proves the real git calls. Skipped if git
// is missing.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ingestLocal } from "../../src/local_ingest.js";

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
  repoPath: string;
  baseOid: string;
  headOid: string;
}

const buildFixture = (): Fixture => {
  const root = mkdtempSync(join(tmpdir(), "ct-local-ingest-"));
  const repoPath = join(root, "repo");
  spawnSync("git", ["init", "-q", "-b", "main", repoPath], { env: GIT_ENV });
  writeFileSync(join(repoPath, "a.txt"), "line1\nline2\n");
  git(repoPath, "add", "a.txt");
  git(repoPath, "commit", "-q", "-m", "base commit");
  const baseOid = git(repoPath, "rev-parse", "HEAD").trim();
  writeFileSync(join(repoPath, "a.txt"), "line1\nline2\nline3\n");
  writeFileSync(join(repoPath, "c.txt"), "new\n");
  git(repoPath, "add", "-A");
  git(repoPath, "commit", "-q", "-m", "head: add line and a file");
  const headOid = git(repoPath, "rev-parse", "HEAD").trim();
  return { root, repoPath, baseOid, headOid };
};

// One shared fixture for the whole file, built once. Every test only reads (diffs)
// the repo and never mutates it, so a per-test rebuild was pure overhead. The
// holder stays empty when git is missing so the skipped suite builds nothing.
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

describe.skipIf(!hasGit())("ingestLocal (REAL git, offline)", () => {
  it("diffs a real base..head range and derives the diff model", async () => {
    await withFixture(async (fixture) => {
      const result = await ingestLocal(
        {},
        { repoPath: fixture.repoPath, base: fixture.baseOid, head: fixture.headOid },
      );

      // The raw diff names both changed files.
      expect(result.rawDiff).toContain("a/a.txt");
      expect(result.rawDiff).toContain("c.txt");
      expect(result.rawDiff).toContain("+line3");

      // The file list, in diff order: a.txt modified, c.txt added.
      expect(result.diffModel.files).toEqual([
        { path: "a.txt", oldPath: null, status: "modified" },
        { path: "c.txt", oldPath: null, status: "added" },
      ]);
    });
  });

  it("builds a minimal meta: the head subject as the title, null GitHub fields", async () => {
    await withFixture(async (fixture) => {
      const result = await ingestLocal(
        {},
        { repoPath: fixture.repoPath, base: fixture.baseOid, head: fixture.headOid },
      );

      expect(result.meta.title).toBe("head: add line and a file");
      expect(result.meta.baseRef).toBe(fixture.baseOid);
      expect(result.meta.headRef).toBe(fixture.headOid);
      expect(result.meta.repoOwner).toBeNull();
      expect(result.meta.number).toBeNull();
      expect(result.meta.url).toBeNull();
    });
  });

  it("resolves the canonical repo root", async () => {
    await withFixture(async (fixture) => {
      const result = await ingestLocal(
        {},
        { repoPath: fixture.repoPath, base: fixture.baseOid, head: fixture.headOid },
      );
      // Resolve the fixture's real path (macOS uses a /private symlink) first.
      const realRoot = git(fixture.repoPath, "rev-parse", "--show-toplevel").trim();
      expect(result.repoRoot).toBe(realRoot);
    });
  });

  it("produces an empty working-tree diff on a clean checkout", async () => {
    await withFixture(async (fixture) => {
      const result = await ingestLocal({}, { repoPath: fixture.repoPath });
      expect(result.rawDiff).toBe("");
      expect(result.diffModel.files).toEqual([]);
      // The title is the head commit's subject; the head ref is the branch.
      expect(result.meta.title).toBe("head: add line and a file");
      expect(result.meta.headRef).toBe("main");
      expect(result.meta.baseRef).toBe("HEAD");
    });
  });
});
