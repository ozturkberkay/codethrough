// Builds the changed-files list for the explore prompt straight from the diff, so the
// engine does not depend on a platform-specific file list. No I/O: takes the diff,
// returns plain data. The parse and the status/path handling live in parse_diff.ts.

import type { File } from "parse-diff";

import { classifyFile, filePath, parseFiles } from "./parse_diff.js";

/** One changed file, in the shape the explore prompt prints. */
interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  /** Uppercase change type, e.g. "ADDED" | "MODIFIED" | "RENAMED" | "DELETED". */
  changeType: string;
}

/** Count the added and removed lines in one file. */
const countChanges = (f: File): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;
  for (const chunk of f.chunks) {
    for (const change of chunk.changes) {
      if (change.type === "add") {
        additions++;
      } else if (change.type === "del") {
        deletions++;
      }
    }
  }
  return { additions, deletions };
};

/**
 * The changed files from already-parsed diff files, in diff order. Uses the shared
 * path handling and status check (uppercased); a file with no usable path is skipped.
 */
const changedFilesFromFiles = (files: File[]): ChangedFile[] => {
  const result: ChangedFile[] = [];
  for (const f of files) {
    const path = filePath(f);
    if (path !== undefined) {
      const { additions, deletions } = countChanges(f);
      result.push({ path, additions, deletions, changeType: classifyFile(f).toUpperCase() });
    }
  }
  return result;
};

/** Parse the diff and return its changed files (the public, single-arg form). */
const changedFiles = (rawDiff: string): ChangedFile[] => changedFilesFromFiles(parseFiles(rawDiff));

export { changedFiles, changedFilesFromFiles };
export type { ChangedFile };
