// Parse the command line: send the first word to `run`, `auth`, or help, and let
// the per-command parsers handle the rest. The caller passes the args without the
// node/script prefix.

import { type AuthCommand, parseAuthArgs } from "./auth_args.js";
import { parseRunArgs, type RunArgs } from "./run_args.js";

// The parsed command. `help` covers no args, --help/-h, and an unknown command.
type CliCommand =
  | { kind: "run"; args: RunArgs }
  | { kind: "auth"; command: AuthCommand }
  | { kind: "help" };

const HELP_FLAGS = new Set(["--help", "-h", "help"]);

// Parse the args into a command. No args or a help flag gives help; run and auth
// use their own parsers, which may throw an error the shell reports.
const parseCli = (argv: string[]): CliCommand => {
  const [command, ...rest] = argv;
  if (command === undefined || HELP_FLAGS.has(command)) {
    return { kind: "help" };
  }
  if (command === "run") {
    return { kind: "run", args: parseRunArgs(rest) };
  }
  if (command === "auth") {
    return { kind: "auth", command: parseAuthArgs(rest) };
  }
  return { kind: "help" };
};

export { parseCli };
export type { CliCommand };
