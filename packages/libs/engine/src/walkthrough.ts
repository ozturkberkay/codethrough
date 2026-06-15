// Check the composed steps against the catalog and renumber the survivors. No I/O:
// takes the steps and catalog, returns the kept steps (renumbered), the dropped ones
// with a reason, and the set of hunk ids the steps cover.

import type { Step } from "@codethrough/schema";

import type { HunkCatalog } from "./hunk_catalog.js";
import type { Hunk } from "./types.js";

/** A step that was dropped or adjusted, with a reason for the log. */
interface DroppedStep {
  step: Step;
  reason: string;
}

/**
 * The result: the kept steps (sorted and renumbered), the steps dropped entirely,
 * and the steps kept but whose bad line range was reset to highlight the whole hunk.
 * The dropped and adjusted lists each carry a reason for the log.
 */
interface ValidationResult {
  valid: Step[];
  dropped: DroppedStep[];
  adjusted: DroppedStep[];
}

// A line range is exactly two new-side line numbers; anything else is rejected.
const RANGE_LENGTH = 2;

/** The lowest and highest new-side line numbers in a hunk, or null if it has none. */
const newSideRange = (hunk: Hunk): { min: number; max: number } | null => {
  if (hunk.lines.length === 0) {
    return null;
  }
  const lines = hunk.lines.map((l) => l.line);
  return { min: Math.min(...lines), max: Math.max(...lines) };
};

/**
 * Why this step's line range is bad, or null if it is fine. A null range means the
 * whole hunk and always passes. Otherwise the range must be two numbers, start no
 * greater than end, both inside the hunk's new-side lines. The schema cannot enforce
 * this, so we check it here.
 */
const lineRangeReason = (step: Step, hunk: Hunk): string | null => {
  const range = step.lineRange;
  if (range === null) {
    return null;
  }
  if (range.length !== RANGE_LENGTH) {
    return `lineRange must be null or exactly two new-side line numbers (got ${range.length}).`;
  }
  const [start, end] = range as [number, number];
  if (start > end) {
    return `lineRange must have start <= end (got [${start}, ${end}]).`;
  }
  const bounds = newSideRange(hunk);
  if (bounds === null) {
    return `lineRange [${start}, ${end}] is outside hunk ${hunk.id} (it has no new-side lines).`;
  }
  if (start < bounds.min || end > bounds.max) {
    return `lineRange [${start}, ${end}] is outside hunk ${hunk.id}'s new-side range [${bounds.min}, ${bounds.max}].`;
  }
  return null;
};

/**
 * The verdict for one step: drop it (unknown hunk), keep it but adjust it (real
 * hunk, bad range reset to the whole hunk), or keep it as is. Both the batch
 * validator and the streaming one share this so the rule lives in one place.
 */
type StepVerdict =
  | { kind: "drop"; reason: string }
  | { kind: "adjust"; step: Step; reason: string }
  | { kind: "keep"; step: Step };

/**
 * Judge one step against the catalog (the shared rule): an unknown hunk id is
 * dropped; a real hunk with a bad range is kept with the range reset to null (the
 * whole hunk); otherwise it is kept as is. No renumbering (the caller sets the
 * number).
 */
const classifyStepAgainst = (step: Step, byId: Map<string, Hunk>): StepVerdict => {
  const hunk = byId.get(step.hunkId);
  if (hunk === undefined) {
    return { kind: "drop", reason: `unknown hunk id "${step.hunkId}".` };
  }
  const reason = lineRangeReason(step, hunk);
  if (reason !== null) {
    // The hunk is real, only the range is bad. Keep the step and its text, and fall
    // back to highlighting the whole hunk.
    return { kind: "adjust", step: { ...step, lineRange: null }, reason };
  }
  return { kind: "keep", step };
};

/** Index a catalog's hunks by id (the lookup both validators build). */
const indexHunks = (catalog: HunkCatalog): Map<string, Hunk> =>
  new Map(catalog.hunks.map((h) => [h.id, h]));

/**
 * Judge one step and put it in the right bucket: an unknown hunk id is dropped; a
 * real hunk with a bad range is kept with the range reset to null and recorded as
 * adjusted; otherwise it is kept as is.
 */
const classifyStep = (step: Step, byId: Map<string, Hunk>, out: ValidationResult): void => {
  const verdict = classifyStepAgainst(step, byId);
  if (verdict.kind === "drop") {
    out.dropped.push({ step, reason: verdict.reason });
    return;
  }
  if (verdict.kind === "adjust") {
    out.adjusted.push({ step, reason: verdict.reason });
    out.valid.push(verdict.step);
    return;
  }
  out.valid.push(verdict.step);
};

/**
 * Check and clean up the composed steps against the catalog.
 *
 * A step is dropped only when its hunk id is not in the catalog (there is nothing to
 * attach it to). If the hunk is real but the range is bad, the step is kept with the
 * range reset to null (the whole hunk) and recorded as adjusted, so its text survives
 * even when the model picked a bad range. The kept steps are sorted by the model's
 * number, then renumbered 0, 1, 2 with no gaps so the UI can navigate by position.
 * Dropped and adjusted steps carry a reason for the log.
 */
const validateSteps = (steps: Step[], catalog: HunkCatalog): ValidationResult => {
  const byId = indexHunks(catalog);
  const result: ValidationResult = { valid: [], dropped: [], adjusted: [] };

  for (const step of steps) {
    classifyStep(step, byId, result);
  }

  // Sort by the model's number, then renumber to the array position.
  const reindexed = result.valid
    .toSorted((a, b) => a.order - b.order)
    .map((step, index) => ({ ...step, order: index }));

  return { valid: reindexed, dropped: result.dropped, adjusted: result.adjusted };
};

/** The hunk ids the kept steps cover (drives the "not covered" marker). */
const coveredHunkIds = (validSteps: Step[]): Set<string> =>
  new Set(validSteps.map((s) => s.hunkId));

export { classifyStepAgainst, coveredHunkIds, indexHunks, validateSteps };
export type { DroppedStep, StepVerdict, ValidationResult };
