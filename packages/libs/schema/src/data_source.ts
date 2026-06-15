import type { Comment, CommentDelta, CommentDraft } from "./comment.js";
import type { ReviewContext, ReviewData, ReviewEvent } from "./review.js";
import type { WalkthroughChunk } from "./chunk.js";

/// Called with each batch of comment changes as it arrives.
export type CommentDeltaListener = (delta: CommentDelta) => void;

/// The interface the review UI talks to. The CLI fills it in over its local
/// server today; a hosted backend can fill it in later. Walkthrough generation is
/// split into start, stream, and cancel so it works the same way either way.
export interface ReviewDataSource {
  context: ReviewContext;
  getReview(): Promise<ReviewData>;
  startWalkthrough(): Promise<{ jobId: string }>;
  streamWalkthrough(jobId: string): AsyncIterable<WalkthroughChunk>;
  cancelWalkthrough(jobId: string): Promise<void>;
  listComments(): Promise<Comment[]>;
  listDrafts(): Promise<CommentDraft[]>;
  draftComment(d: CommentDraft): Promise<void>;
  submitReview(r: { event: ReviewEvent; body?: string }): Promise<void>;
  /// Watch for live comment changes. Optional: a backend without live comments
  /// leaves it out, and the UI just shows the comments it loaded at the start.
  /// Returns a function that stops watching.
  subscribeComments?(onDelta: CommentDeltaListener): () => void;
  capabilities: { comments: boolean };
}
