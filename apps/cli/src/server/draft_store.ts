// Holds the reviewer's draft comments for one run, in memory. They build up here
// until a single submit sends them all and clears the store. Nothing is saved, so
// closing the CLI drops unsent drafts.
//
// A draft is checked against the schema before it is stored, so a bad one is
// rejected here instead of reaching GitHub. Just an array behind a small API.

import { safeParse } from "valibot";
import { type CommentDraft, CommentDraft as CommentDraftSchema } from "@codethrough/schema";

// What the routes call: add (check and store), list, and clear (after a submit).
// `add` returns the draft, or null when it is invalid so the route can send a 400.
interface DraftStore {
  add: (body: unknown) => CommentDraft | null;
  list: () => CommentDraft[];
  clear: () => void;
}

const createDraftStore = (): DraftStore => {
  const drafts: CommentDraft[] = [];

  // Validate the posted body against the CommentDraft schema, append on success.
  const add = (body: unknown): CommentDraft | null => {
    const result = safeParse(CommentDraftSchema, body);
    if (!result.success) {
      return null;
    }
    drafts.push(result.output);
    return result.output;
  };

  // A defensive copy so a caller cannot mutate the backing array.
  const list = (): CommentDraft[] => [...drafts];

  // Drop every draft (called once a review submit succeeds).
  const clear = (): void => {
    drafts.length = 0;
  };

  return { add, list, clear };
};

export { createDraftStore };
export type { DraftStore };
