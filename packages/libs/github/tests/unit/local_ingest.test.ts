// Tests for local ingest. The git runner is a fake, so the argv choice (range vs
// working tree), the minimal meta, and the title and branch fallbacks run with no
// real git.

import { parse } from "valibot";
import { describe, expect, it } from "vitest";

import { ReviewMeta } from "@codethrough/schema";

import type { CommandRunner, RunResult } from "../../src/command.js";
import { ingestLocal } from "../../src/local_ingest.js";

const RAW_DIFF = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): RunResult => ({ code: 1, stdout: "", stderr });

// A runner that branches on the git subcommand, so each test sets only what it
// needs. It handles the toplevel, branch, subject, and diff commands.
interface Scripted {
  toplevel?: RunResult;
  branch?: RunResult;
  subject?: RunResult;
  diff?: RunResult;
}

const scriptedRunner = (s: Scripted): { run: CommandRunner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: CommandRunner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.includes("--show-toplevel")) {
      return s.toplevel ?? ok("/repo/root\n");
    }
    if (args.includes("--abbrev-ref")) {
      return s.branch ?? ok("main\n");
    }
    if (args.includes("show")) {
      return s.subject ?? ok("Head subject\n");
    }
    return s.diff ?? ok(RAW_DIFF);
  };
  return { run, calls };
};

describe("ingestLocal: range mode", () => {
  it("diffs base...head and labels the refs from the args", async () => {
    const r = scriptedRunner({ subject: ok("Range subject\n") });
    const result = await ingestLocal({ run: r.run }, { repoPath: "/repo", base: "v1", head: "v2" });

    expect(r.calls).toContainEqual(["git", "-C", "/repo/root", "diff", "v1...v2"]);
    // The subject is read from the head rev.
    expect(r.calls).toContainEqual(["git", "-C", "/repo/root", "show", "-s", "--format=%s", "v2"]);
    expect(result.meta.baseRef).toBe("v1");
    expect(result.meta.headRef).toBe("v2");
    expect(result.meta.title).toBe("Range subject");
  });

  it("returns the raw diff plus a derived diff model and the toplevel root", async () => {
    const r = scriptedRunner({});
    const result = await ingestLocal({ run: r.run }, { repoPath: "/repo", base: "a", head: "b" });

    expect(result.rawDiff).toBe(RAW_DIFF);
    expect(result.diffModel.files).toEqual([{ path: "a.ts", oldPath: null, status: "modified" }]);
    expect(result.repoRoot).toBe("/repo/root");
  });

  it("produces a schema-valid ReviewMeta with null GitHub-only fields", async () => {
    const r = scriptedRunner({});
    const result = await ingestLocal({ run: r.run }, { repoPath: "/repo", base: "a", head: "b" });

    expect(parse(ReviewMeta, result.meta)).toEqual(result.meta);
    expect(result.meta.repoOwner).toBeNull();
    expect(result.meta.repoName).toBeNull();
    expect(result.meta.number).toBeNull();
    expect(result.meta.url).toBeNull();
    expect(result.meta.author).toBeNull();
    expect(result.meta.body).toBe("");
  });

  it("cleanup is a no-op (path mode creates nothing)", async () => {
    const r = scriptedRunner({});
    const result = await ingestLocal({ run: r.run }, { repoPath: "/repo", base: "a", head: "b" });
    await expect(result.cleanup()).resolves.toBeUndefined();
  });
});

describe("ingestLocal: working-tree mode (no base/head)", () => {
  it("runs the plain working-tree diff and uses HEAD + the current branch", async () => {
    const r = scriptedRunner({ branch: ok("feature-x\n"), subject: ok("Tip commit\n") });
    const result = await ingestLocal({ run: r.run }, { repoPath: "/repo" });

    expect(r.calls).toContainEqual(["git", "-C", "/repo/root", "diff"]);
    expect(result.meta.baseRef).toBe("HEAD");
    expect(result.meta.headRef).toBe("feature-x");
    expect(result.meta.title).toBe("Tip commit");
  });

  it("falls back to a placeholder title when the head has no subject", async () => {
    const r = scriptedRunner({ subject: fail("unknown revision") });
    const result = await ingestLocal({ run: r.run }, { repoPath: "/repo" });
    expect(result.meta.title).toBe("Local changes");
  });

  it("falls back to HEAD as the headRef when the branch lookup fails", async () => {
    const r = scriptedRunner({ branch: fail("detached") });
    const result = await ingestLocal({ run: r.run }, { repoPath: "/repo" });
    expect(result.meta.headRef).toBe("HEAD");
  });

  it("uses a placeholder when the subject is whitespace only", async () => {
    const r = scriptedRunner({ subject: ok("   \n") });
    const result = await ingestLocal({ run: r.run }, { repoPath: "/repo" });
    expect(result.meta.title).toBe("Local changes");
  });
});

describe("ingestLocal: errors", () => {
  it("throws when the path is not a git repository", async () => {
    const run: CommandRunner = async () => fail("not a git repository");
    await expect(ingestLocal({ run }, { repoPath: "/tmp/nope" })).rejects.toThrow(
      /not a git repository failed/,
    );
  });

  it("throws when the diff command fails", async () => {
    const r = scriptedRunner({ diff: fail("bad revision") });
    await expect(
      ingestLocal({ run: r.run }, { repoPath: "/repo", base: "x", head: "y" }),
    ).rejects.toThrow(/git diff failed: bad revision/);
  });

  it("falls back to stdout then a sentinel when a failing command has no stderr", async () => {
    // Empty stderr but stdout has detail, so stdout is used.
    const withStdout: RunResult = { code: 1, stdout: "stdout detail", stderr: "" };
    const r = scriptedRunner({ diff: withStdout });
    await expect(
      ingestLocal({ run: r.run }, { repoPath: "/repo", base: "x", head: "y" }),
    ).rejects.toThrow(/git diff failed: stdout detail/);

    // Both empty, so the "no output" fallback is used.
    const silent: RunResult = { code: 1, stdout: "", stderr: "" };
    const r2 = scriptedRunner({ diff: silent });
    await expect(
      ingestLocal({ run: r2.run }, { repoPath: "/repo", base: "x", head: "y" }),
    ).rejects.toThrow(/git diff failed: no output/);
  });
});
