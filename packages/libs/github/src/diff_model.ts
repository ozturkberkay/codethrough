// Build the DiffModel from a raw diff. No I/O.
//
// This is the small `{ rawDiff, files }` shape the frontend uses. The files list
// drives the file index and the per-file comment areas. It is file-level only,
// unlike the row-level index in comment_diff_index.

import parseDiff, { type File } from "parse-diff";

import type { DiffFile, DiffModel, FileStatus } from "@codethrough/schema";

// The marker the parser uses for the missing side of an add or delete.
const DEV_NULL = "/dev/null";

// A side's real path, or null when there is none. Collapsing both "no path" cases
// to null lets callers check presence once.
const usablePath = (side: string | undefined): string | null =>
  side === undefined || side === DEV_NULL ? null : side;

// Work out how a file changed. Order matters: an add or delete flag wins first,
// then a rename (both paths present but different), then a plain edit.
const statusOf = (file: File, newPath: string | null, oldPath: string | null): FileStatus => {
  if (file.new === true) {
    return "added";
  }
  if (file.deleted === true) {
    return "deleted";
  }
  if (newPath !== null && oldPath !== null && newPath !== oldPath) {
    return "renamed";
  }
  return "modified";
};

// Convert one parsed file to a DiffFile, or null when it has no path on either
// side. The path is the new path, falling back to the old path for a delete. Only
// a rename keeps an oldPath.
//
// The no-newline marker that breaks the row-level index is harmless here, since
// we never look at individual lines.
const toDiffFile = (file: File): DiffFile | null => {
  const newPath = usablePath(file.to);
  const oldSidePath = usablePath(file.from);
  const status = statusOf(file, newPath, oldSidePath);
  // Use the new path; a delete has none, so fall back to the old path.
  const path = newPath ?? oldSidePath;
  if (path === null) {
    return null;
  }
  const oldPath = status === "renamed" ? oldSidePath : null;
  return { path, oldPath, status };
};

// Build the DiffModel: the raw diff as-is plus the file list.
const buildDiffModel = (rawDiff: string): DiffModel => {
  const files: DiffFile[] = [];
  for (const file of parseDiff(rawDiff)) {
    const diffFile = toDiffFile(file);
    if (diffFile !== null) {
      files.push(diffFile);
    }
  }
  return { rawDiff, files };
};

export { buildDiffModel };
