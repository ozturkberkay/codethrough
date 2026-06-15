// Engine types. The engine takes a small input that does not depend on any
// platform; reading the PR from GitHub is the CLI's job.

/** PR details the engine needs for the explore prompt. */
export interface EngineMeta {
  title: string;
  body: string;
  baseRef: string;
  headRef: string;
}

/** Everything the engine reads about one change: the diff, the local clone root to
 * limit exploration to, and the details for the prompt. */
export interface EngineInput {
  rawDiff: string;
  /** The local clone root; exploration cannot read outside it. */
  repoRoot: string;
  meta: EngineMeta;
}

/** How a kept file changed, derived from parse-diff's flags. */
export type FileStatus = "added" | "modified" | "renamed";

/** A diff change kind: an added, removed, or unchanged (context) line. */
export type RowType = "add" | "del" | "normal";

/**
 * One diff line in source order. Removed and unchanged lines are kept too so a
 * side-by-side view can show both sides, not just additions.
 */
export interface RenderRow {
  /** The hunk this row belongs to (e.g. "h0"). */
  hunkId: string;
  /** New-side path of the file the hunk belongs to. */
  file: string;
  type: RowType;
  /** Old-side line number, or null for an added row. */
  oldLine: number | null;
  /** New-side line number, or null for a removed row. */
  newLine: number | null;
  /** Line text with the leading +/-/space removed. */
  content: string;
}

/** One new-side line of a hunk: what the model reads under a hunk id. */
export interface HunkLine {
  /** New-side line number. */
  line: number;
  content: string;
}

/**
 * What the model sees for one hunk: a stable id plus its new-side lines (added and
 * unchanged), so the model picks from this fixed list instead of making up line
 * numbers. The renderer uses the full rows; this is just that fixed list.
 */
export interface Hunk {
  /** Stable id, numbered across the whole diff (e.g. "h0", "h1"). */
  id: string;
  /** New-side path of the file. */
  file: string;
  status: FileStatus;
  /** New-side lines only (added and unchanged), in source order. */
  lines: HunkLine[];
}
