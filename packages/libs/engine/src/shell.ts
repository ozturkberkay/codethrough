// The only place that spawns processes. Kept tiny so the rest of the code stays easy
// to test.

import type { CommandResult, CommandRunner } from "./command.js";

/** Run a command with no shell, capturing stdout, stderr, and the exit code. */
export const runCommand: CommandRunner = async (
  argv: string[],
  signal?: AbortSignal,
): Promise<CommandResult> => {
  const [cmd, ...args] = argv;
  // The command list is built internally and always has a command; guard for safety.
  if (cmd === undefined) {
    throw new Error("runCommand received an empty argv.");
  }

  // The signal, when given, lets callers set a timeout; Bun kills the child. Pass it
  // only when present.
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    ...(signal ? { signal } : {}),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
};
