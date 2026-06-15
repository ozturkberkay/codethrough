// Navigation helpers for the walkthrough panel: move between steps, format the
// position label, and find where to scroll for a step. Pure, so unit-tested.
import type { CodeViewLineScrollTarget } from "@pierre/diffs";
import type { DiffModel, Step } from "@codethrough/schema";
import { resolveStepAnchor } from "./annotations.js";

// Keep an index within range, or -1 when there are no steps. Stays valid as more
// steps stream in.
const clampIndex = (index: number, count: number): number => {
  if (count <= 0) {
    return -1;
  }
  if (index < 0) {
    return 0;
  }
  const last = count - 1;
  return index > last ? last : index;
};

// Move to the next step, stopping at the last one.
const nextIndex = (index: number, count: number): number =>
  clampIndex(clampIndex(index, count) + 1, count);

// Move to the previous step, stopping at the first one.
const prevIndex = (index: number, count: number): number =>
  clampIndex(clampIndex(index, count) - 1, count);

// The position label, like "2 / 5". Shows "0 / 0" when there are no steps.
const positionLabel = (index: number, count: number): string => {
  const display = count <= 0 ? 0 : clampIndex(index, count) + 1;
  return `${display} / ${count}`;
};

// Find where to scroll for a step. Returns undefined when the step's line is
// unknown, so the caller can stay put instead of jumping somewhere wrong.
const scrollTargetForStep = (
  step: Step,
  diffModel: DiffModel,
): CodeViewLineScrollTarget | undefined => {
  const anchor = resolveStepAnchor(step, diffModel);
  if (anchor === undefined) {
    return undefined;
  }
  return {
    type: "line",
    id: anchor.path,
    lineNumber: anchor.lineNumber,
    side: anchor.side,
    align: "center",
  };
};

export { clampIndex, nextIndex, positionLabel, prevIndex, scrollTargetForStep };
