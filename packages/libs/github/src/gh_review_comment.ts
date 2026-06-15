// The fields we use from a GitHub review comment. The real object has more; we
// type only what placement needs so the test fakes stay small.

import type { DiffSide } from "./comment_diff_index.js";

export interface GhReviewComment {
  id: number;
  path: string;
  // The line in the current diff, or null if the comment is outdated (its line
  // is gone from the current diff).
  line: number | null;
  side: DiffSide | null;
  // The first line of a multi-line comment; null for a single line.
  start_line: number | null;
  start_side: DiffSide | null;
  // The line at the time the comment was written. Survives going outdated.
  original_line: number | null;
  in_reply_to_id: number | null;
  // "line" for a normal comment, "file" for a whole-file one.
  subject_type: "line" | "file";
  // The diff hunk saved when the comment was written. May be stale. Used to
  // re-place outdated comments by matching its last line.
  diff_hunk: string;
  // The author. Defaults to "" when a test fake leaves it out.
  user: { login: string } | null;
  body?: string;
}
