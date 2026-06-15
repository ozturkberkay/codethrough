// The real spawn, network, and filesystem calls. Kept here as the default
// implementations the other modules accept, so those modules can be tested with
// fakes. This file is covered by integration tests instead of unit tests.

import { existsSync, promises as fsp, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { Octokit } from "@octokit/rest";

import type { CommandRunner, RunResult } from "./command.js";
import type { OctokitCtor, OctokitLike } from "./octokit.js";
import type { FileSystem } from "./repo_acquire.js";

// Stand-in exit code for a spawn that never produced one (e.g. a missing binary).
const EXIT_SPAWN_FAILED = -1;

// Read a process to completion into a RunResult.
const drain = async (proc: {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}): Promise<RunResult> => {
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};

// Run a command, capturing stdout, stderr, and the exit code. Secrets go on
// stdin where the tool supports it, since anyone can read argv with `ps`. A
// missing binary returns a result instead of throwing, so gh reuse can try the
// next strategy.
const spawnRunner: CommandRunner = async (cmd, args, stdin) => {
  try {
    if (stdin === undefined) {
      const proc = Bun.spawn([cmd, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      return await drain(proc);
    }
    const proc = Bun.spawn([cmd, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(stdin);
    await proc.stdin.end();
    return await drain(proc);
  } catch {
    // Bun throws right away when the command is not on PATH.
    return { code: EXIT_SPAWN_FAILED, stdout: "", stderr: "ENOENT" };
  }
};

// Build the real octokit client for a token.
const realOctokit = (token: string): OctokitLike => new Octokit({ auth: token });

// Each helper below returns the caller's value if given, else the real one.

// The real sleep, used by the device flow when no clock is given.
const defaultSleep = (ms: number): Promise<void> => Bun.sleep(ms);

// Pick the device-flow sleep: the given one, or the real one.
const resolveSleep = (
  injected: ((ms: number) => Promise<void>) | undefined,
): ((ms: number) => Promise<void>) => injected ?? defaultSleep;

// The real file reader, used by gh reuse when no reader is given.
const defaultReadTextFile = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, "utf8") : null;

// Pick the gh-reuse file reader: the given one, or the real one.
const resolveReadTextFile = (
  injected: ((path: string) => string | null) | undefined,
): ((path: string) => string | null) => injected ?? defaultReadTextFile;

// Pick the octokit constructor: the given one, or the real one.
const resolveOctokitCtor = (injected: OctokitCtor | undefined): OctokitCtor =>
  injected ?? realOctokit;

// Pick the command runner: the given one, or the real spawn.
const resolveCommandRunner = (injected: CommandRunner | undefined): CommandRunner =>
  injected ?? spawnRunner;

// The real filesystem for repo acquisition: a temp dir under the OS tmp root, and
// a recursive remove that ignores a missing dir. A forward slash works as the
// separator on every platform, so we join without node:path.
const defaultFileSystem: FileSystem = {
  mkdtemp: (prefix) => fsp.mkdtemp(`${tmpdir()}/${prefix}`),
  rm: async (dir) => {
    await fsp.rm(dir, { recursive: true, force: true });
  },
};

// Pick the filesystem: the given one, or the real one.
const resolveFileSystem = (injected: FileSystem | undefined): FileSystem =>
  injected ?? defaultFileSystem;

export {
  realOctokit,
  resolveCommandRunner,
  resolveFileSystem,
  resolveOctokitCtor,
  resolveReadTextFile,
  resolveSleep,
  spawnRunner,
};
