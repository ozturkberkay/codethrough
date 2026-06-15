# @codethrough/engine

The comprehension engine: it ingests a diff, builds a closed catalog of diff hunks
(so the model cannot invent line numbers), explores the repository in a sandboxed
read-only loop, and composes an ordered, snippet-by-snippet walkthrough as
streamed, Valibot-validated output.

## Public API

- **Run and stream:** `runEngine`, `streamEngine`, and the `EngineResult` /
  `EngineDeps` types.
- **Catalog:** `buildHunkCatalog`, `capCatalog` (the content-budget cap applied
  before both LLM phases), and the `HunkCatalog` / `CappedCatalog` types.
- **Compose:** `compose`, `composeStream`, `buildPrompt`, `walkthroughFromMessage`,
  `walkthroughOutputFormat`, and the `ComposeOptions` / `ComposeStreamOptions`
  types.
- **Explore:** `explore`, `buildTools`, `ToolError`, and `ExploreOptions`.
- **Validation:** `validateSteps`, `classifyStepAgainst`, `coveredHunkIds`, and
  the `ValidationResult` / `DroppedStep` / `StepVerdict` types (invalid steps are
  dropped and survivors re-indexed).
- **Pricing:** `estimateCostUsd`, `isKnownModel`, `MODEL_PRICING`, and the
  `ModelRate` / `TokenUsage` types.
- **Config:** `resolveConfig`, `DEFAULT_ENGINE_CONFIG`, and the `EngineConfig` /
  `Effort` / `PartialEngineConfig` types (precedence: partial override over the
  `CODETHROUGH_*` env var over the default).
- **Diff and shell:** `changedFiles`, `runCommand`, and the input/output types
  (`EngineInput`, `EngineMeta`, `Hunk`, `HunkLine`, `RenderRow`, `RowType`,
  `FileStatus`, `ChangedFile`, plus the `CommandResult` / `CommandRunner` /
  `EngineLogger` collaborators).
