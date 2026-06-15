// The three read-only explore tools (read_file, grep, glob), each limited to the
// repo root. This file is just the wiring: every tool has a JSON schema for its
// input and a `run` that checks the model's arguments against that schema before
// doing the work. The actual work and the path check live in explore_core.ts; the
// provider turns these into the tools it hands the model.

import type { ModelTool } from "@codethrough/model";

import type { CommandRunner } from "./command.js";
import {
  type ExploreToolLimits,
  type GlobArgs,
  globTool,
  type GrepArgs,
  grepTool,
  type ReadArgs,
  readFileTool,
  ToolError,
} from "./explore_core.js";

// JSON schemas for the three tools' inputs, passed straight to the provider. Plain
// JSON Schema objects, nothing else.
const readInput: Record<string, unknown> = {
  type: "object",
  properties: {
    path: { type: "string", description: "Repository-relative file path." },
    startLine: {
      type: ["integer", "null"],
      description: "1-based first line, or null.",
    },
    endLine: { type: ["integer", "null"], description: "1-based last line, or null." },
  },
  required: ["path", "startLine", "endLine"],
  additionalProperties: false,
};
const grepInput: Record<string, unknown> = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "Regular expression to search for." },
    path: {
      type: ["string", "null"],
      description: "Repository-relative path to limit the search, or null.",
    },
  },
  required: ["pattern", "path"],
  additionalProperties: false,
};
const globInput: Record<string, unknown> = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "Glob pattern, relative to the repository root." },
  },
  required: ["pattern"],
  additionalProperties: false,
};

/** A tool's arguments were not the shape its schema requires. */
const argError = (tool: string): ToolError =>
  new ToolError(`${tool} received malformed arguments.`);

// Pull a string, or a number/null line field, out of the raw arguments. A wrong
// type becomes a tool error instead of crashing the phase.
const asRecord = (args: unknown): Record<string, unknown> | null =>
  typeof args === "object" && args !== null ? (args as Record<string, unknown>) : null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asLineOrNull = (value: unknown): number | null | undefined =>
  value === null || typeof value === "number" ? value : undefined;

/** Check and narrow the read_file arguments, or throw a tool error. */
const parseReadArgs = (args: unknown): ReadArgs => {
  const record = asRecord(args);
  const path = record === null ? null : asString(record["path"]);
  const startLine = record === null ? undefined : asLineOrNull(record["startLine"]);
  const endLine = record === null ? undefined : asLineOrNull(record["endLine"]);
  if (path === null || startLine === undefined || endLine === undefined) {
    throw argError("read_file");
  }
  return { path, startLine, endLine };
};

/** Check and narrow the grep arguments, or throw a tool error. */
const parseGrepArgs = (args: unknown): GrepArgs => {
  const record = asRecord(args);
  const pattern = record === null ? null : asString(record["pattern"]);
  const rawPath = record?.["path"];
  const path = rawPath === null ? null : asString(rawPath);
  if (pattern === null) {
    throw argError("grep");
  }
  return { pattern, path };
};

/** Check and narrow the glob arguments, or throw a tool error. */
const parseGlobArgs = (args: unknown): GlobArgs => {
  const record = asRecord(args);
  const pattern = record === null ? null : asString(record["pattern"]);
  if (pattern === null) {
    throw argError("glob");
  }
  return { pattern };
};

/**
 * What buildTools needs, in one object: the root, the command runner, the ripgrep
 * flag, and the tool limits (timeout, file-size cap, match cap) from config.
 */
interface BuildToolsOptions {
  repoRoot: string;
  run: CommandRunner;
  hasRipgrep: boolean;
  limits: ExploreToolLimits;
}

/** Build the three read-only tools, all limited to the repo root. */
const buildTools = (options: BuildToolsOptions): ModelTool[] => {
  const { repoRoot, run, hasRipgrep, limits } = options;
  return [
    {
      name: "read_file",
      description:
        "Read a UTF-8 text file from the repository, or a line range of it. " +
        "Paths are relative to the repository root. Output is size-capped.",
      inputSchema: readInput,
      run: (args) => readFileTool(repoRoot, parseReadArgs(args), limits.maxFileBytes),
    },
    {
      name: "grep",
      description:
        "Search the repository for a regular expression. Returns matching " +
        "file:line:content rows, count-capped. Optionally restrict to a path.",
      inputSchema: grepInput,
      run: (args, ctx) =>
        grepTool({ run, repoRoot, hasRipgrep, limits }, parseGrepArgs(args), ctx?.signal),
    },
    {
      name: "glob",
      description:
        "List repository files matching a glob pattern (e.g. 'src/**/*.ts'). " +
        "Paths are relative to the repository root and count-capped.",
      inputSchema: globInput,
      run: (args) => globTool(repoRoot, parseGlobArgs(args), limits.maxMatches),
    },
  ];
};

export { buildTools, parseGlobArgs, parseGrepArgs, parseReadArgs };
export type { BuildToolsOptions };
