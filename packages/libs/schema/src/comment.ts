// Most imports here are just validators from one library, so the rule that
// limits dependency count does not apply.
/* oxlint-disable import/max-dependencies */
import {
  array,
  type InferOutput,
  literal,
  maxLength,
  nullable,
  number,
  object,
  picklist,
  pipe,
  string,
  variant,
} from "valibot";

/// Caps on draft text size, so an oversized body or path fails cleanly here. The
/// body cap is generous; the path cap matches a sane filesystem path length.
const MAX_DRAFT_BODY_LENGTH = 65_536;
const MAX_DRAFT_PATH_LENGTH = 4_096;

/// Where a line comment landed on the diff. The first three strategies are live
/// placements; the last one was re-attached by matching the old hunk's last line.
const LinePlacement = object({
  kind: literal("line"),
  strategy: picklist(["exact", "anchored-additions", "anchored-deletions", "outdated-historical"]),
  // The diff viewer's two sides: LEFT means deletions, RIGHT means additions.
  side: picklist(["deletions", "additions"]),
  lineNumber: number(),
  // First line of a multi-line span, else null.
  spanStartLine: nullable(number()),
});

/// A comment with no current line: file-level, or too old to place. Both show in
/// the general comments area.
const GeneralPlacement = object({
  kind: literal("general"),
  strategy: picklist(["outdated-unplaceable", "file-note"]),
});

/// Where a comment maps onto the diff: a line, or a general note.
export const Placement = variant("kind", [LinePlacement, GeneralPlacement]);

export type Placement = InferOutput<typeof Placement>;

/// An existing GitHub review comment plus where it lands on the diff. Note `side`
/// is GitHub's LEFT/RIGHT, while `placement.side` is the diff viewer's wording.
export const Comment = object({
  id: string(),
  path: string(),
  body: string(),
  author: string(),
  line: nullable(number()),
  originalLine: nullable(number()),
  side: picklist(["LEFT", "RIGHT"]),
  startLine: nullable(number()),
  subjectType: picklist(["line", "file"]),
  inReplyToId: nullable(string()),
  placement: Placement,
});

export type Comment = InferOutput<typeof Comment>;

/// A new comment to post, shaped the way GitHub's review API expects.
export const CommentDraft = object({
  path: pipe(string(), maxLength(MAX_DRAFT_PATH_LENGTH)),
  body: pipe(string(), maxLength(MAX_DRAFT_BODY_LENGTH)),
  line: nullable(number()),
  side: nullable(picklist(["LEFT", "RIGHT"])),
  startLine: nullable(number()),
  startSide: nullable(picklist(["LEFT", "RIGHT"])),
  subjectType: picklist(["line", "file"]),
});

export type CommentDraft = InferOutput<typeof CommentDraft>;

/// The comments that changed between two polls. The server computes this and
/// sends it to the frontend, which merges it into the comments it shows.
export const CommentDelta = object({
  added: array(Comment),
  updated: array(Comment),
  removed: array(Comment),
});

export type CommentDelta = InferOutput<typeof CommentDelta>;
