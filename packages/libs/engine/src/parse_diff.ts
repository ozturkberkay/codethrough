// The one place that reads a unified diff: the single parse, the file-status check,
// and the old-vs-new path handling that both the hunk catalog and the changed-files
// summary need. They build their views from here, so neither parses the diff again,
// and runEngine parses it once and feeds the result to both.

import parseDiff, { type File } from "parse-diff";

// The parser reports the new-side path as "/dev/null" for a deletion.
const DEV_NULL = "/dev/null";

/**
 * The change status for one file: new means added, deleted means removed, a
 * different from/to path means renamed, otherwise modified. Both callers map this to
 * their own form (the catalog drops deletions and lowercases; the summary uppercases).
 */
type FileChange = "added" | "deleted" | "renamed" | "modified";

/** Classify a file from parse-diff's flags into the canonical status. */
const classifyFile = (f: File): FileChange => {
  if (f.new) {
    return "added";
  }
  if (f.deleted) {
    return "deleted";
  }
  if (f.from !== f.to) {
    return "renamed";
  }
  return "modified";
};

/**
 * The path that names a file in the diff: the new-side path, but the old-side path
 * for a deletion (whose new side is "/dev/null"). Returns undefined when neither side
 * is usable.
 */
const filePath = (f: File): string | undefined => (f.to && f.to !== DEV_NULL ? f.to : f.from);

/** Parse a unified diff into parse-diff's files (the one place we parse). */
const parseFiles = (rawDiff: string): File[] => parseDiff(rawDiff);

export { classifyFile, filePath, parseFiles };
export type { FileChange };
