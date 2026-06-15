import { array, type InferOutput, nullable, object, picklist, string } from "valibot";

/// How a file changed in the diff.
export const FileStatus = picklist(["added", "modified", "renamed", "deleted"]);

export type FileStatus = InferOutput<typeof FileStatus>;

/// One changed file in the diff. `oldPath` is the name before a rename, else null.
export const DiffFile = object({
  path: string(),
  oldPath: nullable(string()),
  status: FileStatus,
});

export type DiffFile = InferOutput<typeof DiffFile>;

/// The diff the review UI shows: the raw text plus the list of changed files.
export const DiffModel = object({
  rawDiff: string(),
  files: array(DiffFile),
});

export type DiffModel = InferOutput<typeof DiffModel>;
