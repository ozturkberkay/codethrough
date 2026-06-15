# @codethrough/schema

The shared Valibot schemas and the typed contract every other Codethrough package
agrees on. Each schema carries both a runtime validator and an inferred type under
one name, so the engine validates structured model output against the same shapes
the backend serves and the review UI renders. This is the seam that lets a future
hosted SaaS reuse the engine, the GitHub layer, and the UI unchanged: the CLI's
local server and the SaaS backend both implement the one `ReviewDataSource`
contract, so it is "one UI, two backends."

## Public API

- **Schemas (value + type):** `Summary`, `Step`, `Walkthrough`, `DiffFile`,
  `DiffModel`, `FileStatus`, `Comment`, `CommentDelta`, `CommentDraft`,
  `Placement`, `ReviewContext`, `ReviewData`, `ReviewEvent`, `ReviewMeta`, and the
  streamed `WalkthroughChunk` (`summary | step | error | usage | done`).
- **JSON Schema:** `toJsonSchema` plus the `JsonSchema` type, for the Anthropic
  structured-output call.
- **The contract:** the `ReviewDataSource` type (get review, start and stream
  and cancel a walkthrough job, list and draft comments, submit a review,
  subscribe to live comment deltas) and `CommentDeltaListener`.
