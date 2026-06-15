// Checks each piece the reader hands back, using the same rules as the batch
// validator but one step at a time as it arrives. No I/O.
//
// We get the raw JSON for the summary (once) and for each step. For each one we:
//  - parse it (a broken piece is skipped, never crashes),
//  - check its shape against the schema,
//  - for a step, apply the catalog rules (drop an unknown hunk; reset an
//    out-of-range line range to null) and renumber it to its spot among the kept
//    steps so far. Steps arrive in reading order, so this keeps the numbers a tidy
//    0, 1, 2 with no gaps; the counter only moves forward on a kept step.
//
// Keeping this with no I/O lets the rules be tested thoroughly on their own.

// `Step` and `Summary` are schema values whose names also stand in for their types,
// so one import covers both.
import { Step, Summary } from "@codethrough/schema";
import { type BaseIssue, type BaseSchema, safeParse } from "valibot";

import type { HunkCatalog } from "./hunk_catalog.js";
import type { Hunk } from "./types.js";
import { classifyStepAgainst, indexHunks } from "./walkthrough.js";

/** A kept, renumbered step ready to send, or a skip with a reason. */
type StepOutcome = { kind: "step"; step: Step } | { kind: "skip"; reason: string };

// Marker for a parse failure, so we can tell "did not parse" apart from a value
// that really is null or undefined.
const PARSE_FAILED = Symbol("parse-failed");

/** Parse JSON, or return the marker on a syntax error. Never throws. */
const tryParseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // The reader only returns balanced pieces, so this should not happen, but we
    // handle it just in case.
    return PARSE_FAILED;
  }
};

/**
 * Parse a JSON piece and check it against `schema`, or null if the JSON is broken or
 * the shape is wrong. Generic so the summary and step share it: a bad piece is
 * skipped, never thrown.
 */
const parseValid = <T>(
  raw: string,
  schema: BaseSchema<unknown, T, BaseIssue<unknown>>,
): T | null => {
  const value = tryParseJson(raw);
  if (value === PARSE_FAILED) {
    return null;
  }
  const result = safeParse(schema, value);
  return result.success ? result.output : null;
};

/** Check the summary JSON against the schema, or null if it does not fit. */
const parseSummary = (raw: string): Summary | null => parseValid(raw, Summary);

/**
 * Check one step's JSON, apply the catalog rules, and number it with `survivorIndex`.
 * Returns the kept step or a skip with a reason:
 *  - a broken or wrong-shaped piece -> skip,
 *  - an unknown hunk id -> skip (dropped),
 *  - a real hunk with a bad line range -> kept with the range reset to null.
 * The number is set from `survivorIndex`, so the model's own number is ignored and
 * kept steps stay numbered with no gaps.
 */
const validateStep = (raw: string, byId: Map<string, Hunk>, survivorIndex: number): StepOutcome => {
  const parsed = parseValid(raw, Step);
  if (parsed === null) {
    return { kind: "skip", reason: "step did not match the Step schema." };
  }
  const verdict = classifyStepAgainst(parsed, byId);
  if (verdict.kind === "drop") {
    return { kind: "skip", reason: verdict.reason };
  }
  // Kept (whole hunk or a range); set its arrival number.
  return { kind: "step", step: { ...verdict.step, order: survivorIndex } };
};

/**
 * Checks steps in the order they arrive, counting the kept ones so each gets a
 * gap-free number. No I/O; the only state is that count.
 */
interface StepValidator {
  /** Check the next step's JSON; the kept count moves forward only on a keep. */
  next: (raw: string) => StepOutcome;
}

/** Build a per-step validator tied to the catalog's hunks. */
const createStepValidator = (catalog: HunkCatalog): StepValidator => {
  const byId = indexHunks(catalog);
  let survivors = 0;
  return {
    next: (raw: string): StepOutcome => {
      const outcome = validateStep(raw, byId, survivors);
      if (outcome.kind === "step") {
        survivors += 1;
      }
      return outcome;
    },
  };
};

export { createStepValidator, parseSummary };
export type { StepOutcome, StepValidator };
