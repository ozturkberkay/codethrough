// The comment and submit state behind the review screen: the live comment list,
// the pending drafts, and the draft and submit actions. The pure logic lives in
// the helpers; this just wires them up. Covered by end-to-end tests.
import { createSignal, onCleanup } from "solid-js";
import type { Comment, CommentDraft, ReviewDataSource, ReviewEvent } from "@codethrough/schema";
import { applyCommentDelta } from "./comment_draft.js";

// Where a submit is: not started, in progress, done, or failed.
type SubmitStatus = "idle" | "submitting" | "submitted" | "error";

// Everything the write UI reads and the actions it calls.
interface WriteState {
  comments: () => Comment[];
  drafts: () => CommentDraft[];
  submitStatus: () => SubmitStatus;
  submitError: () => string | null;
  canWrite: () => boolean;
  addDraft: (draft: CommentDraft) => Promise<void>;
  submit: (review: { event: ReviewEvent; body?: string }) => Promise<void>;
  // Fill the comment list from the loaded review.
  seedComments: (comments: Comment[]) => void;
}

// Subscribe to live comment updates if the source offers them, applying each one.
// Returns a function to unsubscribe.
const startLiveComments = (
  source: ReviewDataSource,
  setComments: (update: (prev: Comment[]) => Comment[]) => void,
): (() => void) => {
  if (source.subscribeComments === undefined) {
    return () => {};
  }
  return source.subscribeComments((delta) => {
    setComments((prev) => applyCommentDelta(prev, delta));
  });
};

const createWriteState = (source: ReviewDataSource): WriteState => {
  const [comments, setComments] = createSignal<Comment[]>([]);
  const [drafts, setDrafts] = createSignal<CommentDraft[]>([]);
  const [submitStatus, setSubmitStatus] = createSignal<SubmitStatus>("idle");
  const [submitError, setSubmitError] = createSignal<string | null>(null);

  // Save a draft, then re-read the list so it matches what the server stored.
  const addDraft = async (draft: CommentDraft): Promise<void> => {
    await source.draftComment(draft);
    setDrafts(await source.listDrafts());
  };

  // Submit the review, tracking progress. On success the server clears the drafts,
  // so re-reading the list empties it.
  const submit = async (review: { event: ReviewEvent; body?: string }): Promise<void> => {
    setSubmitStatus("submitting");
    setSubmitError(null);
    try {
      await source.submitReview(review);
      setDrafts(await source.listDrafts());
      setSubmitStatus("submitted");
    } catch (error) {
      setSubmitStatus("error");
      setSubmitError(error instanceof Error ? error.message : "submit failed");
    }
  };

  onCleanup(startLiveComments(source, setComments));

  return {
    comments,
    drafts,
    submitStatus,
    submitError,
    canWrite: () => source.capabilities.comments,
    addDraft,
    submit,
    seedComments: (initial) => setComments(initial),
  };
};

export { createWriteState };
export type { SubmitStatus, WriteState };
