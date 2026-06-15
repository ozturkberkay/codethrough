// The heart of the explore phase: the path-safety check, the trimming of tool
// results, the grep command builders, and the three tools (read a file, run grep,
// list files by pattern). The path check and trimming have no I/O and are tested on
// their own; the tools do the real file work. The schema and argument checks live in
// explore_tools.ts.

import { constants as fsConstants, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { CommandRunner } from "./command.js";

// Both git grep and rg exit with 1 to mean "no matches".
const NO_MATCH_EXIT = 1;

/**
 * Limits for the explore tools, passed in from config. `toolTimeoutMs` bounds one
 * tool call (say a slow grep); `maxFileBytes` caps how much of a file we read;
 * `maxMatches` caps how many grep/glob results we return.
 */
interface ExploreToolLimits {
  toolTimeoutMs: number;
  maxFileBytes: number;
  maxMatches: number;
}

/** Arguments the read_file tool takes (matches its JSON schema). */
interface ReadArgs {
  path: string;
  startLine: number | null;
  endLine: number | null;
}

/** Arguments the grep tool takes (matches its JSON schema). */
interface GrepArgs {
  pattern: string;
  path: string | null;
}

/** Arguments the glob tool takes (matches its JSON schema). */
interface GlobArgs {
  pattern: string;
}

/** What the grep tool needs: the runner, the root, the rg flag, and the limits. */
interface GrepDeps {
  run: CommandRunner;
  repoRoot: string;
  hasRipgrep: boolean;
  limits: ExploreToolLimits;
}

// Thrown when a tool is blocked or hits a limit. The tool runner catches it and
// hands the message back to the model as an error, so the loop keeps going.
class ToolError extends Error {}

/** Is `target` the root itself, or somewhere under it? */
const isWithinRoot = (root: string, target: string): boolean => {
  if (target === root) {
    return true;
  }
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/**
 * Work out the real path a tool is allowed to touch, or reject it. We resolve both
 * the root and the target to their real on-disk paths, which blocks both `../`
 * escapes and symlinks that point outside the root (a plain text check would miss
 * the symlink). The request is always treated as relative to the root.
 */
const resolveSandboxedPath = (repoRoot: string, requested: string): string => {
  const realRoot = realpathSync(repoRoot);
  // Force every request to start inside the root, then let realpath resolve any
  // `..` and symlinks. An absolute path cannot escape because we re-root it.
  const joined = resolve(realRoot, requested.replace(/^[/\\]+/, ""));
  try {
    const realTarget = realpathSync(joined);
    if (!isWithinRoot(realRoot, realTarget)) {
      throw new ToolError(`Path "${requested}" is outside the repository.`);
    }
    return realTarget;
  } catch (error) {
    if (error instanceof ToolError) {
      throw error;
    }
    // The file does not exist, so nothing can leak, but still reject a path that
    // points outside the root (e.g. a missing "../../etc/passwd").
    if (!isWithinRoot(realRoot, joined)) {
      throw new ToolError(`Path "${requested}" is outside the repository.`);
    }
    throw new ToolError(`Path "${requested}" was not found in the repository.`);
  }
};

/** Trim text to the byte limit and add a clear marker. */
const capText = (text: string, maxBytes: number): string => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  // Cut at the byte limit, then re-decode to drop a half character at the end.
  const head = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
  return `${head}\n... [truncated at ${maxBytes} bytes]`;
};

/** Return lines startLine..endLine of `text` (1-based, inclusive), clamped to range. */
const sliceLines = (text: string, startLine: number | null, endLine: number | null): string => {
  if (startLine === null && endLine === null) {
    return text;
  }
  const lines = text.split("\n");
  const from = Math.max(1, startLine ?? 1);
  const to = Math.min(lines.length, endLine ?? lines.length);
  if (from > to) {
    return "";
  }
  return lines.slice(from - 1, to).join("\n");
};

/** Keep at most `maxCount` result lines, noting how many were left out. */
const capLines = (lines: string[], maxCount: number): string => {
  if (lines.length === 0) {
    return "No matches.";
  }
  if (lines.length <= maxCount) {
    return lines.join("\n");
  }
  const kept = lines.slice(0, maxCount);
  return `${kept.join("\n")}\n... [${lines.length - maxCount} more omitted]`;
};

/** Build the `git grep` command (used when ripgrep is not installed). */
const gitGrepCommand = (repoRoot: string, pattern: string, path?: string): string[] => {
  // --no-index searches the working tree, so an uncommitted clone still works. -I
  // skips binary files, -n adds line numbers, and -e means the pattern is the
  // pattern, even if it starts with a dash.
  const argv = ["git", "-C", repoRoot, "grep", "--no-index", "-I", "-n", "-e", pattern];
  if (path !== undefined) {
    argv.push("--", path);
  }
  return argv;
};

/** Build the ripgrep command (used when `rg` is available). */
const ripgrepCommand = (repoRoot: string, pattern: string, path?: string): string[] => [
  // --no-heading gives flat file:line:content output, and -e takes the pattern even
  // if it starts with a dash. --no-follow stops rg from following symlinks out of
  // the root; passing it here beats any --follow set in the rg config file.
  "rg",
  "--no-heading",
  "--no-follow",
  "-n",
  "-e",
  pattern,
  path ?? repoRoot,
];

/** A signal that fires after `ms`, or when the phase signal aborts, whichever first. */
const combineTimeout = (ms: number, phaseSignal: AbortSignal | undefined): AbortSignal => {
  const timeout = AbortSignal.timeout(ms);
  return phaseSignal ? AbortSignal.any([timeout, phaseSignal]) : timeout;
};

/**
 * Read a file inside the sandbox (optionally a line range), trimmed to the size
 * limit. The path is first checked and resolved, which rejects anything outside the
 * root. We also open with the no-follow flag: if the file were swapped for a symlink
 * right after the check, the open fails instead of following it out of the sandbox.
 */
const readFileTool = async (
  repoRoot: string,
  args: ReadArgs,
  maxFileBytes: number,
): Promise<string> => {
  const real = resolveSandboxedPath(repoRoot, args.path);
  // Open read-only and refuse to follow a symlink.
  const handle = await open(real, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const text = await handle.readFile("utf8");
    return capText(sliceLines(text, args.startLine, args.endLine), maxFileBytes);
  } finally {
    await handle.close();
  }
};

/**
 * Drop any grep row whose file lives outside the root. Extra safety for the
 * whole-tree scan: even with --no-follow, a symlinked file under the root could
 * point outside, so we resolve each row's file (the part before the first `:`) and
 * keep only the ones still inside the root. Runs before the count cap so the
 * left-out count stays right. A row we cannot parse or resolve is dropped.
 */
const confineGrepRows = (rows: string[], realRoot: string): string[] =>
  rows.filter((row) => {
    const colon = row.indexOf(":");
    if (colon <= 0) {
      // No file name to check, so drop it.
      return false;
    }
    try {
      return isWithinRoot(realRoot, realpathSync(resolve(realRoot, row.slice(0, colon))));
    } catch {
      return false;
    }
  });

/** Run rg (preferred) or git grep, returning capped `file:line:content` rows. */
const grepTool = async (
  deps: GrepDeps,
  args: GrepArgs,
  phaseSignal: AbortSignal | undefined,
): Promise<string> => {
  const { run, repoRoot, hasRipgrep, limits } = deps;
  // Use the resolved root so a symlinked root path does not look like an escape.
  const realRoot = realpathSync(repoRoot);
  // When scanning one path, give rg the full path (rg resolves a relative one
  // against the process working dir, not the root). git grep takes a relative path
  // since it is anchored with -C. The path check rejects an escape before we run.
  const real = args.path === null ? undefined : resolveSandboxedPath(repoRoot, args.path);
  const argv = hasRipgrep
    ? ripgrepCommand(realRoot, args.pattern, real)
    : gitGrepCommand(
        realRoot,
        args.pattern,
        real === undefined ? undefined : relative(realRoot, real),
      );
  // Grep is the only tool that runs another process and could scan a huge tree, so
  // we bound it by both the per-tool timeout and the phase signal. The file tools
  // are already bounded by how much they read.
  const res = await run(argv, combineTimeout(limits.toolTimeoutMs, phaseSignal));
  // Both tools exit 1 for "no matches"; anything higher is a real error.
  if (res.exitCode > NO_MATCH_EXIT) {
    throw new ToolError(`grep failed: ${res.stderr.trim() || "unknown error"}`);
  }
  const raw = res.stdout.split("\n").filter((l) => l.length > 0);
  // A whole-tree scan had no per-path check, so filter its rows; a single-path scan
  // was already checked above.
  const lines = args.path === null ? confineGrepRows(raw, realRoot) : raw;
  return capLines(lines, limits.maxMatches);
};

/** List files in the sandbox matching the pattern, capped, as relative paths. */
const globTool = async (repoRoot: string, args: GlobArgs, maxMatches: number): Promise<string> => {
  const realRoot = realpathSync(repoRoot);
  const glob = new Bun.Glob(args.pattern);
  const matches: string[] = [];
  try {
    // A `../` pattern would list files outside the root, so we keep only matches
    // that land back inside it. A match that is itself a symlink out is fine here,
    // since read_file resolves and blocks it before reading anything.
    for await (const match of glob.scan({ cwd: realRoot, onlyFiles: true })) {
      if (isWithinRoot(realRoot, resolve(realRoot, match))) {
        matches.push(match);
      }
    }
  } catch (error) {
    // A bad pattern can walk into unreadable folders; report it to the model
    // instead of crashing the phase.
    throw new ToolError(`glob failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return capLines(matches, maxMatches);
};

export {
  capLines,
  capText,
  gitGrepCommand,
  globTool,
  grepTool,
  isWithinRoot,
  readFileTool,
  resolveSandboxedPath,
  ripgrepCommand,
  sliceLines,
  ToolError,
};
export type { ExploreToolLimits, GlobArgs, GrepArgs, GrepDeps, ReadArgs };
