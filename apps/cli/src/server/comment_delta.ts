// Find what changed between two comment lists. The poller re-fetches comments and
// sends only the changes, so the frontend updates a little instead of reloading.
//
// Comments are matched by id. Across two lists a comment is:
//   - added: in the new list, not the old
//   - removed: in the old list, not the new
//   - updated: in both but not the same
// Added/updated keep the new list's order; removed keeps the old list's order.

import type { Comment, CommentDelta } from "@codethrough/schema";

// Index a list by id for fast lookup. A repeated id keeps the last one.
const indexById = (comments: Comment[]): Map<string, Comment> => {
  const byId = new Map<string, Comment>();
  for (const comment of comments) {
    byId.set(comment.id, comment);
  }
  return byId;
};

// Whether two comments are the same. A comment is plain data with a fixed key
// order, so a JSON compare is a sound, cheap deep-equal and needs no library.
const sameComment = (a: Comment, b: Comment): boolean => JSON.stringify(a) === JSON.stringify(b);

// Split two lists into added, updated, and removed. Every id lands in one bucket
// (or none, when unchanged).
const diffCommentLists = (prev: Comment[], next: Comment[]): CommentDelta => {
  const prevById = indexById(prev);
  const nextById = indexById(next);

  const added: Comment[] = [];
  const updated: Comment[] = [];
  for (const comment of next) {
    const before = prevById.get(comment.id);
    if (before === undefined) {
      added.push(comment);
    } else if (!sameComment(before, comment)) {
      updated.push(comment);
    }
  }

  const removed = prev.filter((comment) => !nextById.has(comment.id));
  return { added, updated, removed };
};

// True when nothing changed, so the poller can skip sending an empty frame.
const isEmptyDelta = (delta: CommentDelta): boolean =>
  delta.added.length === 0 && delta.updated.length === 0 && delta.removed.length === 0;

export { diffCommentLists, isEmptyDelta };
