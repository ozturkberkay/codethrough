// Sorts the flat comment list into the groups the UI shows: comments on a diff
// line, file or PR notes, and replies grouped under their parent. Pure data work,
// unit-tested.
import type { Comment } from "@codethrough/schema";

// The sorted comments. Each list holds only top-level comments; replies are kept
// separately, keyed by their parent's id, so a thread shows as one unit.
interface GroupedComments {
  lineComments: Comment[];
  generalByPath: Map<string, Comment[]>;
  prGeneral: Comment[];
  repliesByParentId: Map<string, Comment[]>;
}

// True when the comment sits on a real diff line. Otherwise it is a note.
const isLineComment = (comment: Comment): boolean => comment.placement.kind === "line";

// True when the comment names a file. A blank path means it is a PR-wide note.
const hasMeaningfulPath = (comment: Comment): boolean => comment.path.trim().length > 0;

// Add a comment to the list for a key, starting the list if needed.
const pushInto = (map: Map<string, Comment[]>, key: string, comment: Comment): void => {
  const list = map.get(key) ?? [];
  list.push(comment);
  map.set(key, list);
};

// Sort the comments into the groups above. A reply always goes with its parent,
// even if it would otherwise sit somewhere else. Original order is kept.
const groupComments = (comments: Comment[]): GroupedComments => {
  const lineComments: Comment[] = [];
  const generalByPath = new Map<string, Comment[]>();
  const prGeneral: Comment[] = [];
  const repliesByParentId = new Map<string, Comment[]>();

  for (const comment of comments) {
    if (comment.inReplyToId !== null) {
      pushInto(repliesByParentId, comment.inReplyToId, comment);
    } else if (isLineComment(comment)) {
      lineComments.push(comment);
    } else if (hasMeaningfulPath(comment)) {
      pushInto(generalByPath, comment.path, comment);
    } else {
      prGeneral.push(comment);
    }
  }

  return { lineComments, generalByPath, prGeneral, repliesByParentId };
};

export { groupComments };
export type { GroupedComments };
