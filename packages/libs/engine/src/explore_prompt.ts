// Builds the first message for the explore phase. No I/O. Kept separate from the
// loop and the tools so each file stays small.

import { changedFiles, type ChangedFile } from "./diff_summary.js";
import type { HunkCatalog } from "./hunk_catalog.js";
import type { EngineInput } from "./types.js";

/** Render the hunk catalog block (new-side lines grouped by hunk id). */
const renderHunks = (catalog: HunkCatalog): string =>
  catalog.hunks
    .map((h) => {
      const body = h.lines.map((l) => `  ${l.line}: ${l.content}`).join("\n");
      return `### ${h.id} (${h.file}, ${h.status})\n${body}`;
    })
    .join("\n\n");

/** Render the changed-files block from the already-derived summary. */
const renderChangedFiles = (files: ChangedFile[]): string =>
  files.map((f) => `- ${f.path} (${f.changeType}, +${f.additions}/-${f.deletions})`).join("\n");

/**
 * The first message: PR details, the hunk catalog, and instructions to gather
 * concrete findings and read at least the main changed files plus one caller or
 * test before finishing. The changed files come from the diff; when not passed in,
 * they are worked out here, but runEngine passes them so the diff is parsed once.
 */
const buildExplorePrompt = (
  input: EngineInput,
  catalog: HunkCatalog,
  files: ChangedFile[] = changedFiles(input.rawDiff),
): string => {
  const { meta } = input;
  const changed = renderChangedFiles(files);
  const hunks = renderHunks(catalog);
  return [
    "You are exploring a code repository to understand how a pull request fits the",
    "wider codebase. You have read-only tools: read_file, grep, and glob, all scoped",
    "to the repository root.",
    "",
    "## Pull request",
    `Title: ${meta.title}`,
    `Base: ${meta.baseRef}  Head: ${meta.headRef}`,
    "",
    "Description:",
    meta.body.trim() || "(no description provided)",
    "",
    "## Changed files",
    changed || "(none reported)",
    "",
    "## Hunk catalog (new-side lines, grouped by hunk id)",
    hunks || "(catalog is empty)",
    "",
    "## Your task",
    "Investigate how this change fits the codebase, then write a context brief.",
    "Gather CONCRETE findings, not prose impressions: name the specific callers and",
    "callees of changed symbols, the files and line references involved, the",
    "conventions the change follows or breaks, and the relevant tests.",
    "",
    "Before you conclude, inspect at least the definitions in the primary changed",
    "files and at least one caller or test of a changed symbol. Use grep/glob to",
    "locate them and read_file to read them.",
    "",
    "When you have enough, stop calling tools and reply with the brief as plain",
    "text: specific file paths, symbol names, and how the pieces connect.",
  ].join("\n");
};

export { buildExplorePrompt };
