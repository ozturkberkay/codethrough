// Parse the `codethrough run` args into a RunArgs. The caller passes the words
// after `run`. Telling a PR URL from a local path reuses the github package's
// parser so the URL rules stay in one place.
//
//   codethrough run [<pr-url>|<path>] [--base <rev>] [--head <rev>] [--repo <path>]
//                   [--model <id>] [--effort low|high|max] [--no-open] [--port <n>]

import { parsePrUrl, type PrRef } from "@codethrough/github";
import type { Effort } from "@codethrough/engine";

// The accepted effort values, listed here so we can validate without a value
// import from the engine (Effort is type-only).
const EFFORTS = ["low", "high", "max"] as const;

// What the run targets: a PR reference or a local path. `raw` keeps the original
// word for error messages.
type RunTarget =
  | { kind: "pr"; ref: PrRef; raw: string }
  | { kind: "path"; path: string; raw: string };

// The parsed `run` command. model and effort are optional so the config resolver
// can apply its own precedence. port is checked here; the rest are plain strings.
interface RunArgs {
  // Defaults to the current directory when no path is given.
  target: RunTarget;
  base?: string;
  head?: string;
  repo?: string;
  model?: string;
  effort?: Effort;
  open: boolean;
  port?: number;
}

// A parse failure with a readable reason.
class RunArgsError extends Error {}

// The flags that take a value, so the loop knows to read the next word.
const VALUE_FLAGS = new Set(["--base", "--head", "--repo", "--model", "--effort", "--port"]);

// Parse a port: a positive integer in the legal range.
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const parsePort = (value: string): number => {
  if (!/^\d+$/.test(value)) {
    throw new RunArgsError(`--port must be a positive integer (got "${value}").`);
  }
  const port = Number(value);
  if (port < MIN_PORT || port > MAX_PORT) {
    throw new RunArgsError(`--port must be between ${MIN_PORT} and ${MAX_PORT} (got "${value}").`);
  }
  return port;
};

// Read a value as an Effort, or throw naming the legal values.
const parseEffort = (value: string): Effort => {
  if (!(EFFORTS as readonly string[]).includes(value)) {
    throw new RunArgsError(`--effort must be one of ${EFFORTS.join(", ")} (got "${value}").`);
  }
  return value as Effort;
};

// Read the target as a PR reference when it looks like one, else a local path.
const classifyTarget = (raw: string): RunTarget => {
  const ref = parsePrUrl(raw);
  if (ref !== null) {
    return { kind: "pr", ref, raw };
  }
  return { kind: "path", path: raw, raw };
};

// Read the word after a value flag, or throw when it is missing.
const valueAfter = (flag: string, tokens: string[], index: number): string => {
  const value = tokens[index + 1];
  if (value === undefined) {
    throw new RunArgsError(`${flag} requires a value.`);
  }
  return value;
};

// Store one value flag on `args`.
const applyValueFlag = (flag: string, value: string, args: RunArgs): void => {
  switch (flag) {
    case "--base": {
      args.base = value;
      break;
    }
    case "--head": {
      args.head = value;
      break;
    }
    case "--repo": {
      args.repo = value;
      break;
    }
    case "--model": {
      args.model = value;
      break;
    }
    case "--effort": {
      args.effort = parseEffort(value);
      break;
    }
    // Only --port is left.
    default: {
      args.port = parsePort(value);
    }
  }
};

// Store the positional target. Throws on a second one. Returns the updated
// "seen a positional" flag.
const applyPositional = (token: string, sawPositional: boolean, args: RunArgs): boolean => {
  if (token.startsWith("--")) {
    throw new RunArgsError(`Unknown flag: ${token}`);
  }
  if (sawPositional) {
    throw new RunArgsError(`Unexpected extra argument: ${token}`);
  }
  args.target = classifyTarget(token);
  return true;
};

// Parse the words after `run`. The default target is the current directory, so a
// bare `codethrough run` is valid. A value flag advances the index by two so it
// consumes its value.
const parseRunArgs = (tokens: string[]): RunArgs => {
  const args: RunArgs = { target: { kind: "path", path: ".", raw: "." }, open: true };
  let sawPositional = false;
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index] as string;
    if (token === "--no-open") {
      args.open = false;
      index += 1;
    } else if (VALUE_FLAGS.has(token)) {
      applyValueFlag(token, valueAfter(token, tokens, index), args);
      index += 2;
    } else {
      sawPositional = applyPositional(token, sawPositional, args);
      index += 1;
    }
  }

  return args;
};

export { parseRunArgs, RunArgsError };
export type { RunArgs, RunTarget };
