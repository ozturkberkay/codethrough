// Builds the compose message. No I/O. In its own file so compose.ts stays small: the
// instructions are a constant, and buildPrompt adds the hunk catalog, the brief, and
// an optional note that the catalog is partial.

import type { HunkCatalog } from "./hunk_catalog.js";

/** Set when the catalog was trimmed, so the model is told it is partial. */
interface ComposePromptOptions {
  truncated?: boolean;
}

// Writing guidance that does not depend on the PR. The catalog and brief follow.
const INSTRUCTIONS = [
  "You are writing a guided walkthrough of a pull request for a reviewer who has",
  "NO prior context. Assume they do not know this codebase, this feature, or why",
  "the change exists. Your job is to make the change fast and easy to understand.",
  "",
  "How to write (this matters more than completeness):",
  "- Explain WHAT the change does and, above all, WHY it is being made. Skip the",
  "  HOW: do not narrate the code or walk through implementation details.",
  "- Use plain language and short sentences. Avoid jargon. Do not pile up function",
  "  names, file names, or technical terms; name something only when it is truly",
  "  needed to make the point.",
  "- Keep it light and skimmable. Each explanation is one to three short sentences,",
  "  never a paragraph or a wall of text. The reviewer should get each step in a",
  "  few seconds.",
  "- When in doubt, pick the simpler, clearer wording over the precise-but-dense one.",
  "",
  "The summary is the MOST IMPORTANT part. Write it for a first-time reader in clean,",
  "plain language, with no assumed context and no packed-in terms:",
  "- problem: what was wrong or missing, in human terms.",
  "- statusQuo: how things worked before this change, simply put.",
  "- solution: in a sentence or two, the overall idea of how this change solves the",
  "  problem and changes the status quo. The big picture, not the details; this is",
  "  the bridge between the problem and the specific decisions below.",
  "- keyDecisions: the few main choices this change makes, and briefly why each.",
  "",
  "Then the steps. Order them BY HOW THE DATA FLOWS THROUGH THE SYSTEM, not by",
  "file order and not by importance. Start where the data originates (what gets",
  "produced, or where a request first enters), then follow it forward through each",
  "stage that uses or transforms it, in the order it actually moves at runtime, and",
  "end with the final result. Put tests last. A change is easiest to follow when it",
  "reads in one direction, like a story.",
  "For example: if this change builds a dataset that a pipeline later consumes,",
  "explain the dataset's creation first, then each pipeline stage in the order it",
  "processes that data. For a request flow, go in the order the data moves: the",
  "request comes in, the system receives it, processes it, then responds.",
  "Each step has a short, plain-language title and a one-to-three-sentence",
  "explanation of what that part does and why it matters.",
  "",
  "Mechanics (keep these out of your writing style):",
  "- Each step references exactly one hunk by its hunk id from the catalog below.",
  "  Never invent a hunk id; only use ids that appear in the catalog.",
  "- Optionally narrow a step to a line sub-range with `lineRange` as two new-side",
  "  line numbers [start, end] that exist within that hunk; otherwise use null.",
  "- `order` is a 1-based position in reading order.",
].join("\n");

const TRUNCATION_NOTE =
  "Note: this hunk catalog is PARTIAL (it was capped); some changed hunks are " +
  "not listed, so do not assume the change is fully represented here.";

/** Render the hunk catalog block (new-side lines grouped by hunk id). */
const renderHunks = (catalog: HunkCatalog): string =>
  catalog.hunks
    .map((h) => {
      const body = h.lines.map((l) => `  ${l.line}: ${l.content}`).join("\n");
      return `### ${h.id} (${h.file}, ${h.status})\n${body}`;
    })
    .join("\n\n");

/**
 * The compose message: the instructions, the hunk catalog (so steps can only point at
 * catalog hunk ids), and the explore brief. If the catalog was trimmed, a line tells
 * the model it is partial.
 */
const buildPrompt = (
  catalog: HunkCatalog,
  brief: string,
  opts: ComposePromptOptions = {},
): string => {
  const hunks = renderHunks(catalog);
  return [
    INSTRUCTIONS,
    ...(opts.truncated ? [TRUNCATION_NOTE] : []),
    "",
    "## Hunk catalog (new-side lines, grouped by hunk id)",
    hunks || "(catalog is empty)",
    "",
    "## Context brief (from repository exploration)",
    brief.trim() || "(no brief was produced)",
  ].join("\n");
};

export { buildPrompt };
export type { ComposePromptOptions };
