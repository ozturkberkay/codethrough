// Maps a GitHub review comment to a diff row, and back.
//
// placeComment turns a GitHub comment into our Comment with a placement: a line
// (pinned or re-anchored) or a general note when it has no line. GitHub LEFT maps
// to the deletions side, RIGHT to additions.
//
// rowToDraftTarget goes the other way, turning a clicked annotation into a draft
// for a new comment.

import type { Comment, CommentDraft, Placement } from "@codethrough/schema";

import {
  type CommentDiffIndex,
  type DiffRow,
  type DiffSide,
  findRow,
} from "./comment_diff_index.js";
import type { GhReviewComment } from "./gh_review_comment.js";

// The two sides Pierre uses. GitHub LEFT maps to deletions, RIGHT to additions.
type PierreSide = "deletions" | "additions";

// Where Pierre puts an annotation: a side and a line.
interface PierreAnnotation {
  side: PierreSide;
  lineNumber: number;
}

// The line variant of Placement, for helpers that always build a line placement.
type LinePlacement = Extract<Placement, { kind: "line" }>;

// How a comment landed on a line that is in the diff.
type RowStrategy = "exact" | "anchored-additions" | "anchored-deletions";

interface RowPlacement {
  annotation: PierreAnnotation;
  strategy: RowStrategy;
}

// The side to assume when a comment has none. GitHub omits it for some
// single-line RIGHT comments.
const DEFAULT_GH_SIDE: DiffSide = "RIGHT";

// Turn a diff row into an annotation plus how it landed. An add or delete sits
// on its own side. A context line exists on both sides, so we put it on whichever
// side the reviewer used.
const annotationForRow = (row: DiffRow, ghSide: DiffSide): RowPlacement => {
  switch (row.kind) {
    case "add": {
      return { annotation: { side: "additions", lineNumber: row.newLine }, strategy: "exact" };
    }
    case "del": {
      return { annotation: { side: "deletions", lineNumber: row.oldLine }, strategy: "exact" };
    }
    case "context": {
      if (ghSide === "LEFT") {
        return {
          annotation: { side: "deletions", lineNumber: row.oldLine },
          strategy: "anchored-deletions",
        };
      }
      return {
        annotation: { side: "additions", lineNumber: row.newLine },
        strategy: "anchored-additions",
      };
    }
  }
};

// The Comment fields that are the same regardless of placement.
const baseComment = (gh: GhReviewComment): Omit<Comment, "placement"> => ({
  id: String(gh.id),
  path: gh.path,
  body: gh.body ?? "",
  author: gh.user?.login ?? "",
  line: gh.line,
  originalLine: gh.original_line,
  side: gh.side ?? DEFAULT_GH_SIDE,
  startLine: gh.start_line,
  subjectType: gh.subject_type,
  inReplyToId: gh.in_reply_to_id === null ? null : String(gh.in_reply_to_id),
});

// The start line of a multi-line comment. GitHub stores the end line as `line`,
// so the start is `start_line` when it differs, else there is no span.
const spanStartFor = (gh: GhReviewComment): number | null =>
  gh.start_line !== null && gh.start_line !== gh.line ? gh.start_line : null;

// Build a line placement from a row annotation and the comment's span.
const linePlacement = (placed: RowPlacement, gh: GhReviewComment): LinePlacement => ({
  kind: "line",
  strategy: placed.strategy,
  side: placed.annotation.side,
  lineNumber: placed.annotation.lineNumber,
  spanStartLine: spanStartFor(gh),
});

// Drop the leading +/-/space so two lines can be compared by content.
const stripMarker = (line: string): string => (line.length > 0 ? line.slice(1) : "");

// Find a current row whose content matches the last line of the comment's saved
// hunk. Returns undefined when nothing matches.
const reanchorRow = (index: CommentDiffIndex, gh: GhReviewComment): DiffRow | undefined => {
  const rows = index.rowsByPath.get(gh.path);
  const hunkLines = gh.diff_hunk ? gh.diff_hunk.split("\n") : [];
  const anchorContent = stripMarker(hunkLines.at(-1) ?? "");
  if (!rows || !anchorContent) {
    return undefined;
  }
  return rows.find((r) => stripMarker(r.content) === anchorContent);
};

// Place an outdated comment. If its saved hunk still matches a line in the
// current diff, anchor there. Otherwise it goes to the general area.
const placeOutdated = (index: CommentDiffIndex, gh: GhReviewComment): Placement => {
  const hit = reanchorRow(index, gh);
  if (!hit) {
    return { kind: "general", strategy: "outdated-unplaceable" };
  }
  const placed = annotationForRow(hit, gh.side ?? DEFAULT_GH_SIDE);
  return { ...linePlacement(placed, gh), strategy: "outdated-historical" };
};

// Decide where one comment goes: file note, live line, or outdated.
const placementFor = (index: CommentDiffIndex, gh: GhReviewComment): Placement => {
  // A whole-file comment has no line.
  if (gh.subject_type === "file") {
    return { kind: "general", strategy: "file-note" };
  }
  // No line means GitHub marked it outdated.
  if (gh.line === null) {
    return placeOutdated(index, gh);
  }
  const side = gh.side ?? DEFAULT_GH_SIDE;
  const row = findRow(index, { path: gh.path, line: gh.line, side });
  // The line can still be missing from our diff (e.g. we fetched a smaller diff
  // than the comment's commit). Treat that like an outdated comment.
  return row ? linePlacement(annotationForRow(row, side), gh) : placeOutdated(index, gh);
};

// Turn a GitHub comment into our Comment with a placement.
const placeComment = (index: CommentDiffIndex, gh: GhReviewComment): Comment => ({
  ...baseComment(gh),
  placement: placementFor(index, gh),
});

// Turn a clicked annotation into a draft for a new comment. A second annotation
// marks the start of a multi-line drag; GitHub stores the end line.
const rowToDraftTarget = (
  path: string,
  pierre: PierreAnnotation,
  start?: PierreAnnotation,
): CommentDraft => {
  const side: DiffSide = pierre.side === "additions" ? "RIGHT" : "LEFT";
  const isMultiLine =
    start !== undefined && start.side === pierre.side && start.lineNumber !== pierre.lineNumber;

  return {
    path,
    body: "",
    line: isMultiLine ? Math.max(start.lineNumber, pierre.lineNumber) : pierre.lineNumber,
    side,
    startLine: isMultiLine ? Math.min(start.lineNumber, pierre.lineNumber) : null,
    startSide: isMultiLine ? side : null,
    subjectType: "line",
  };
};

// Place a list of comments, keeping order so the UI can thread replies.
const placeAll = (index: CommentDiffIndex, comments: GhReviewComment[]): Comment[] =>
  comments.map((c) => placeComment(index, c));

export { placeAll, placeComment, rowToDraftTarget };
export type { PierreAnnotation, PierreSide };
