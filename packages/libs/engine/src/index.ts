// Public surface of @codethrough/engine. Values first, then the type-only exports
// (they have to be listed separately).

export { runEngine } from "./run.js";
export { streamEngine } from "./stream_engine.js";
export { buildHunkCatalog, capCatalog } from "./hunk_catalog.js";
export { compose, buildPrompt, walkthroughFromOutput, walkthroughOutputSchema } from "./compose.js";
export { composeStream } from "./compose_stream.js";
export { estimateCostUsd, isKnownModel, MODEL_PRICING } from "./pricing.js";
export { explore } from "./explore.js";
export { buildTools } from "./explore_tools.js";
export { ToolError } from "./explore_core.js";
export { classifyStepAgainst, coveredHunkIds, validateSteps } from "./walkthrough.js";
export { changedFiles } from "./diff_summary.js";
export { runCommand } from "./shell.js";

// Type-only exports.
export type { EngineResult } from "./run.js";
export type { EngineDeps } from "./prepare_compose.js";
export type { HunkCatalog, CappedCatalog } from "./hunk_catalog.js";
export type { ComposeOptions } from "./compose.js";
export type { ComposeStreamOptions } from "./compose_stream.js";
export type { ModelRate, TokenUsage } from "./pricing.js";
export type { ExploreOptions } from "./explore.js";
export type { ValidationResult, DroppedStep, StepVerdict } from "./walkthrough.js";
export type { ChangedFile } from "./diff_summary.js";
export type { EngineConfig, Effort } from "./config.js";
export type { CommandResult, CommandRunner, EngineLogger } from "./command.js";
export type {
  EngineInput,
  EngineMeta,
  Hunk,
  HunkLine,
  RenderRow,
  RowType,
  FileStatus,
} from "./types.js";
