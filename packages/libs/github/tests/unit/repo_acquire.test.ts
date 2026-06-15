// Tests for repo acquisition. The command runner and filesystem are fakes, so the
// exact git argv (clone flags, fetch by commit, checkout by commit) and the
// cleanup (removes a temp dir we made; never the user's repo) run with no real git.

import { describe, expect, it } from "vitest";

import type { CommandRunner, RunResult } from "../../src/command.js";
import {
  type FileSystem,
  prepareRepoFromClone,
  prepareRepoFromLocal,
} from "../../src/repo_acquire.js";

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): RunResult => ({ code: 1, stdout: "", stderr });

// A runner that records every git argv and returns results in order. rev-parse
// --show-toplevel returns a fixed root, and other commands fall back to a stub.
interface Recorder {
  run: CommandRunner;
  calls: string[][];
}

const recorder = (results: RunResult[], toplevel = "/canonical/root"): Recorder => {
  const calls: string[][] = [];
  let i = 0;
  const run: CommandRunner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.includes("--show-toplevel")) {
      return ok(`${toplevel}\n`);
    }
    const result = results[i] ?? ok();
    i += 1;
    return result;
  };
  return { run, calls };
};

// A filesystem fake that records mkdtemp and rm calls; mkdtemp returns a fixed path.
interface FakeFs {
  fs: FileSystem;
  made: string[];
  removed: string[];
}

const fakeFs = (madePath = "/tmp/codethrough-clone-xyz"): FakeFs => {
  const made: string[] = [];
  const removed: string[] = [];
  const fs: FileSystem = {
    mkdtemp: async (prefix) => {
      made.push(prefix);
      return madePath;
    },
    rm: async (dir) => {
      removed.push(dir);
    },
  };
  return { fs, made, removed };
};

describe("prepareRepoFromClone", () => {
  const args = {
    cloneUrl: "https://github.com/octo/demo.git",
    headRefOid: "deadbeef1234",
    dir: "/tmp/clone-dir",
  };

  it("runs the exact partial-clone, fetch-by-oid, checkout-by-oid sequence", async () => {
    const rec = recorder([ok(), ok(), ok()]);
    await prepareRepoFromClone({ run: rec.run, fs: fakeFs().fs }, args);

    expect(rec.calls).toEqual([
      ["git", "clone", "--filter=blob:none", "--no-checkout", args.cloneUrl, args.dir],
      ["git", "-C", args.dir, "fetch", "--depth", "1", "origin", args.headRefOid],
      ["git", "-C", args.dir, "checkout", args.headRefOid],
      ["git", "-C", args.dir, "rev-parse", "--show-toplevel"],
    ]);
  });

  it("returns the canonical toplevel from rev-parse", async () => {
    const rec = recorder([ok(), ok(), ok()], "/private/tmp/clone-dir");
    const repo = await prepareRepoFromClone({ run: rec.run, fs: fakeFs().fs }, args);
    expect(repo.repoRoot).toBe("/private/tmp/clone-dir");
  });

  it("cleanup removes the cloned dir (we created it)", async () => {
    const rec = recorder([ok(), ok(), ok()]);
    const fs = fakeFs();
    const repo = await prepareRepoFromClone({ run: rec.run, fs: fs.fs }, args);

    expect(fs.removed).toEqual([]);
    await repo.cleanup();
    expect(fs.removed).toEqual([args.dir]);
  });

  it("tolerates clone/fetch stderr warnings on a zero exit", async () => {
    // A local partial clone prints a filtering warning on stderr but exits 0.
    const warn: RunResult = { code: 0, stdout: "", stderr: "warning: filtering not recognized" };
    const rec = recorder([warn, warn, ok()]);
    const repo = await prepareRepoFromClone({ run: rec.run, fs: fakeFs().fs }, args);
    expect(repo.repoRoot).toBe("/canonical/root");
  });

  it("throws with context when the clone fails", async () => {
    const rec = recorder([fail("could not resolve host github.com")]);
    await expect(prepareRepoFromClone({ run: rec.run, fs: fakeFs().fs }, args)).rejects.toThrow(
      /git clone failed: could not resolve host/,
    );
  });

  it("throws with context when the fetch fails", async () => {
    const rec = recorder([ok(), fail("oid not found")]);
    await expect(prepareRepoFromClone({ run: rec.run, fs: fakeFs().fs }, args)).rejects.toThrow(
      /git fetch failed: oid not found/,
    );
  });

  it("throws with context when the checkout fails", async () => {
    const rec = recorder([ok(), ok(), fail("reference is not a tree")]);
    await expect(prepareRepoFromClone({ run: rec.run, fs: fakeFs().fs }, args)).rejects.toThrow(
      /git checkout failed: reference is not a tree/,
    );
  });

  it("falls back to stdout, then a sentinel, when stderr is empty on failure", async () => {
    const noStderr: RunResult = { code: 1, stdout: "stdout detail", stderr: "" };
    const rec = recorder([noStderr]);
    await expect(prepareRepoFromClone({ run: rec.run, fs: fakeFs().fs }, args)).rejects.toThrow(
      /git clone failed: stdout detail/,
    );

    const silent: RunResult = { code: 1, stdout: "", stderr: "" };
    const rec2 = recorder([silent]);
    await expect(prepareRepoFromClone({ run: rec2.run, fs: fakeFs().fs }, args)).rejects.toThrow(
      /git clone failed: no output/,
    );
  });
});

describe("prepareRepoFromLocal", () => {
  it("resolves the toplevel and checks out the oid when given", async () => {
    const rec = recorder([ok()], "/home/me/repo");
    const repo = await prepareRepoFromLocal(
      { run: rec.run },
      { repoPath: "/home/me/repo/subdir", headRefOid: "cafef00d" },
    );

    expect(repo.repoRoot).toBe("/home/me/repo");
    expect(rec.calls).toEqual([
      ["git", "-C", "/home/me/repo/subdir", "rev-parse", "--show-toplevel"],
      ["git", "-C", "/home/me/repo", "checkout", "cafef00d"],
    ]);
  });

  it("skips the checkout when no oid is given (working tree as-is)", async () => {
    const rec = recorder([], "/home/me/repo");
    await prepareRepoFromLocal({ run: rec.run }, { repoPath: "/home/me/repo" });

    expect(rec.calls).toEqual([["git", "-C", "/home/me/repo", "rev-parse", "--show-toplevel"]]);
  });

  it("cleanup is a no-op (never removes a user's repo)", async () => {
    const rec = recorder([], "/home/me/repo");
    const repo = await prepareRepoFromLocal({ run: rec.run }, { repoPath: "/home/me/repo" });
    // Resolves without throwing and touches no filesystem.
    await expect(repo.cleanup()).resolves.toBeUndefined();
  });

  it("throws when the path is not a git repository", async () => {
    const run: CommandRunner = async () => fail("not a git repository");
    await expect(prepareRepoFromLocal({ run }, { repoPath: "/tmp/not-a-repo" })).rejects.toThrow(
      /not a git repository: \/tmp\/not-a-repo failed/,
    );
  });
});
