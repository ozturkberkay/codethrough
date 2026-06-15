// Integration: runs the real runCommand against real `sh`/`git`, no network. Runs
// under Bun. Shows it spawns, captures stdout/stderr/exit, honors an abort signal, and
// guards an empty command.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCommand } from "../../src/shell.js";

let repo = "";

const git = (...args: string[]): void => {
  Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "ct-shell-"));
  git("init", "-q");
  git("config", "user.email", "t@t.co");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "f.txt"), "a\nb\nc\n");
  git("add", "-A");
  git("commit", "-qm", "base");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("runCommand (real spawn)", () => {
  it("captures stdout and a zero exit code", async () => {
    const res = await runCommand(["sh", "-c", "printf hello"]);
    expect(res).toMatchObject({ stdout: "hello", exitCode: 0 });
  });

  it("captures stderr and a non-zero exit code", async () => {
    const res = await runCommand(["sh", "-c", "echo boom 1>&2; exit 3"]);
    expect(res.exitCode).toBe(3);
    expect(res.stderr.trim()).toBe("boom");
  });

  it("runs a real git command against a fixture repo", async () => {
    const res = await runCommand(["git", "-C", repo, "rev-parse", "--show-toplevel"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim().length).toBeGreaterThan(0);
  });

  it("kills the child when the abort signal fires", async () => {
    // An already-aborted signal makes Bun kill the child; the call still resolves with
    // a non-zero exit instead of hanging.
    const res = await runCommand(["sh", "-c", "sleep 5"], AbortSignal.abort());
    expect(res.exitCode).not.toBe(0);
  });

  it("throws on an empty argv", async () => {
    await expect(runCommand([])).rejects.toThrow(/empty argv/);
  });
});
