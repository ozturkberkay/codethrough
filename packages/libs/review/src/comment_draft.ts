// Helpers for the write side: build a draft comment from a clicked line, and
// apply live comment updates to the list. Pure data work, unit-tested.
import type { Comment, CommentDelta, CommentDraft } from "@codethrough/schema";

// Which side of the diff a clicked line is on: new code or old code.
type DraftSide = "additions" | "deletions";

// Where a line comment is being written: the file, the side, the line, and the
// text.
interface LineDraftTarget {
  path: string;
  side: DraftSide;
  lineNumber: number;
  body: string;
}

// Map our side names to GitHub's: new code is RIGHT, old code is LEFT.
const githubSide = (side: DraftSide): "LEFT" | "RIGHT" => (side === "additions" ? "RIGHT" : "LEFT");

// Build a comment on a single line. We do not support multi-line yet, so the span
// fields are null.
const buildLineDraft = (target: LineDraftTarget): CommentDraft => ({
  path: target.path,
  body: target.body,
  line: target.lineNumber,
  side: githubSide(target.side),
  startLine: null,
  startSide: null,
  subjectType: "line",
});

// Build a comment on a whole file, not tied to any line.
const buildFileDraft = (path: string, body: string): CommentDraft => ({
  path,
  body,
  line: null,
  side: null,
  startLine: null,
  startSide: null,
  subjectType: "file",
});

// Apply a live update to the comment list: remove some, replace some, add the
// rest. Returns a new list and keeps the original order.
const applyCommentDelta = (comments: Comment[], delta: CommentDelta): Comment[] => {
  const removed = new Set(delta.removed.map((comment) => comment.id));
  const updatedById = new Map(delta.updated.map((comment) => [comment.id, comment]));
  // Keep what is left, swapping in any updated versions.
  const kept = comments
    .filter((comment) => !removed.has(comment.id))
    .map((comment) => updatedById.get(comment.id) ?? comment);
  // Add the new ones, skipping any we already have.
  const present = new Set(kept.map((comment) => comment.id));
  const appended = delta.added.filter((comment) => !present.has(comment.id));
  return [...kept, ...appended];
};

export { applyCommentDelta, buildFileDraft, buildLineDraft };
export type { DraftSide, LineDraftTarget };
