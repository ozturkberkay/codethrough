// What this package exports. We ship the source directly; the apps that use it do
// their own build, and pre-building the Solid code here would break it.

// The top-level component and the panels it composes.
export { Review } from "./review";
export { ReviewLayout } from "./review_layout";
export { DiffView } from "./diff_view";
export { SummaryPanel } from "./summary_panel";
export { WalkthroughPanel } from "./walkthrough_panel";
export { GeneralComments } from "./general_comments";
export { CommentThread } from "./comment_thread";
export { WritePanel } from "./write_panel";

// The pure helpers, used by the components and the apps.
export {
  commentAnnotations,
  hunkIndex,
  lineCommentAnnotations,
  partitionAnnotations,
  resolveStepAnchor,
  scrollTargetFor,
  stepAnnotations,
  toCodeViewItems,
} from "./annotations";
export { groupComments } from "./comment_groups";
export { applyCommentDelta, buildFileDraft, buildLineDraft } from "./comment_draft";
export { createWriteState } from "./write_state";
export { errorTitle } from "./error_banner";
export { formatCost, formatElapsed, formatTokens, formatUsageFooter } from "./usage_footer";
export { walkthroughToMarkdown } from "./markdown";
export {
  consumeWalkthrough,
  initialWalkthroughState,
  reduceWalkthrough,
} from "./walkthrough_stream";
// This scrollTargetForStep takes a step, not an annotation. It is the one to use.
export { clampIndex, nextIndex, positionLabel, prevIndex, scrollTargetForStep } from "./step_nav";

export type {
  AnnotationMeta,
  AnnotationSide,
  HunkEntry,
  ReviewAnnotation,
  ReviewCodeViewItem,
  StepLike,
} from "./annotations";
export type { ReviewProps } from "./review";
export type { ReviewLayoutProps } from "./review_layout";
export type { SummaryPanelProps } from "./summary_panel";
export type { WalkthroughPanelProps } from "./walkthrough_panel";
export type { GeneralCommentsProps } from "./general_comments";
export type { CommentThreadProps } from "./comment_thread";
export type { GroupedComments } from "./comment_groups";
export type { DraftSide, LineDraftTarget } from "./comment_draft";
export type { SubmitStatus, WriteState } from "./write_state";
export type { WritePanelProps } from "./write_panel";
export type {
  WalkthroughError,
  WalkthroughState,
  WalkthroughStatus,
  WalkthroughUsage,
} from "./walkthrough_stream";
