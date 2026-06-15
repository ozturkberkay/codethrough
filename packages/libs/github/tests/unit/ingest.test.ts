// Tests for PR ingest. The octokit client, git runner, and filesystem are all
// fakes, so the whole flow (fetch meta and diff, build the model, get the repo)
// runs with no network and no real git.

import { describe, expect, it } from "vitest";

import type { CommandRunner, RunResult } from "../../src/command.js";
import { cloneUrlFor, ingestPr } from "../../src/ingest.js";
import type { PrPullsClient } from "../../src/pr_ingest.js";
import type { FileSystem } from "../../src/repo_acquire.js";

const REF = { owner: "octo", repo: "demo", number: 42 };

const RAW_DIFF = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;

const pullData = {
  title: "Add b",
  body: "Adds b.",
  html_url: "https://github.com/octo/demo/pull/42",
  base: { ref: "main", sha: "basesha" },
  head: { ref: "feature", sha: "headsha" },
  user: { login: "octocat" },
};

// A fake octokit that returns the JSON normally and the raw diff for a diff
// request.
const fakeOctokit = (): PrPullsClient => ({
  rest: {
    pulls: {
      get: async (params) => {
        const isDiff = params.mediaType?.format === "diff";
        return { data: (isDiff ? RAW_DIFF : pullData) as never };
      },
    },
  },
});

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });

// A git runner that records argv; rev-parse --show-toplevel returns a fixed root.
const gitRecorder = (toplevel: string): { run: CommandRunner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: CommandRunner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return args.includes("--show-toplevel") ? ok(`${toplevel}\n`) : ok();
  };
  return { run, calls };
};

const fakeFs = (madePath: string): { fs: FileSystem; made: string[]; removed: string[] } => {
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

describe("cloneUrlFor", () => {
  it("builds the canonical public https clone URL with no token", () => {
    expect(cloneUrlFor(REF)).toBe("https://github.com/octo/demo.git");
  });
});

describe("ingestPr: partial-clone path (no local repo)", () => {
  it("mints a temp dir and partial-clones at the head oid", async () => {
    const git = gitRecorder("/tmp/clone/root");
    const fs = fakeFs("/tmp/codethrough-clone-abc");
    const result = await ingestPr({ octokit: fakeOctokit(), run: git.run, fs: fs.fs }, REF);

    // A temp dir was requested with the codethrough prefix.
    expect(fs.made).toEqual(["codethrough-clone-"]);
    // The first git call partial-clones into that dir.
    expect(git.calls[0]).toEqual([
      "git",
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      "https://github.com/octo/demo.git",
      "/tmp/codethrough-clone-abc",
    ]);
    // It fetched and checked out the head commit from the meta call.
    expect(git.calls).toContainEqual([
      "git",
      "-C",
      "/tmp/codethrough-clone-abc",
      "fetch",
      "--depth",
      "1",
      "origin",
      "headsha",
    ]);
    expect(git.calls).toContainEqual([
      "git",
      "-C",
      "/tmp/codethrough-clone-abc",
      "checkout",
      "headsha",
    ]);
    expect(result.repoRoot).toBe("/tmp/clone/root");
  });

  it("returns the mapped meta, raw diff, diff model, and head oid", async () => {
    const git = gitRecorder("/tmp/clone/root");
    const fs = fakeFs("/tmp/codethrough-clone-abc");
    const result = await ingestPr({ octokit: fakeOctokit(), run: git.run, fs: fs.fs }, REF);

    expect(result.headRefOid).toBe("headsha");
    expect(result.rawDiff).toBe(RAW_DIFF);
    expect(result.meta.title).toBe("Add b");
    expect(result.meta.repoOwner).toBe("octo");
    expect(result.diffModel.files).toEqual([{ path: "a.ts", oldPath: null, status: "modified" }]);
  });

  it("cleanup removes the minted clone dir", async () => {
    const git = gitRecorder("/tmp/clone/root");
    const fs = fakeFs("/tmp/codethrough-clone-abc");
    const result = await ingestPr({ octokit: fakeOctokit(), run: git.run, fs: fs.fs }, REF);

    await result.cleanup();
    expect(fs.removed).toEqual(["/tmp/codethrough-clone-abc"]);
  });
});

describe("ingestPr: local-repo path", () => {
  it("uses the local clone (no temp dir) and checks out the head oid", async () => {
    const git = gitRecorder("/home/me/demo");
    const fs = fakeFs("/should/not/be/used");
    const result = await ingestPr({ octokit: fakeOctokit(), run: git.run, fs: fs.fs }, REF, {
      localRepoPath: "/home/me/demo",
    });

    // No temp dir was made and nothing was cloned.
    expect(fs.made).toEqual([]);
    expect(git.calls.some((c) => c.includes("clone"))).toBe(false);
    // It found the repo root and checked out the head commit in place.
    expect(git.calls).toEqual([
      ["git", "-C", "/home/me/demo", "rev-parse", "--show-toplevel"],
      ["git", "-C", "/home/me/demo", "checkout", "headsha"],
    ]);
    expect(result.repoRoot).toBe("/home/me/demo");
  });

  it("cleanup is a no-op for a local repo (removes nothing)", async () => {
    const git = gitRecorder("/home/me/demo");
    const fs = fakeFs("/unused");
    const result = await ingestPr({ octokit: fakeOctokit(), run: git.run, fs: fs.fs }, REF, {
      localRepoPath: "/home/me/demo",
    });

    await result.cleanup();
    expect(fs.removed).toEqual([]);
  });
});
