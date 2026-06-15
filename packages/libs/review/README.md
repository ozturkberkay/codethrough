# @codethrough/review

The SolidJS review UI: the `@pierre/diffs` diff wiring, ordered walkthrough
navigation, the problem / status-quo / solution / key-decisions summary, line and
general (non-line) comments, copy-as-Markdown, and the per-run cost and elapsed
footer. The UI consumes a single `ReviewDataSource` (from `@codethrough/schema`)
and nothing else, so it is the `ReviewDataSource` seam in practice: the CLI serves
it over the local server now, and a future hosted SaaS serves the same components
over the hosted API later. Source is exported as-is (no prebuilt dist) so the
consuming app's Vite build keeps Solid's compile-time reactivity.

## Public API

- **Components:** `Review` (the top level), `ReviewLayout`, `DiffView`,
  `SummaryPanel`, `WalkthroughPanel`, `GeneralComments`, `CommentThread`, and
  `WritePanel`, with their prop types.
- **Walkthrough stream:** `consumeWalkthrough`, `reduceWalkthrough`,
  `initialWalkthroughState`, and the `WalkthroughState` / `WalkthroughStatus` /
  `WalkthroughError` / `WalkthroughUsage` types (the reducer drives the thin-result
  and error states).
- **Annotations (the pure core):** `toCodeViewItems`, `hunkIndex`,
  `stepAnnotations`, `commentAnnotations`, `lineCommentAnnotations`,
  `partitionAnnotations`, `resolveStepAnchor`, `scrollTargetFor`, and their types.
- **Comments and drafts:** `groupComments`, `applyCommentDelta`, `buildLineDraft`,
  `buildFileDraft`, `createWriteState`, and the grouping / draft / write-state
  types.
- **Step navigation:** `clampIndex`, `nextIndex`, `prevIndex`, `positionLabel`,
  and `scrollTargetForStep`.
- **Formatting and export:** `formatCost`, `formatElapsed`, `formatTokens`,
  `formatUsageFooter` (the cost and elapsed footer), `errorTitle` (the
  generation-error banner), and `walkthroughToMarkdown` (copy-as-Markdown).
