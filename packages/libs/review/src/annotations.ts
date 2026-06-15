// Turns our comments and steps into the shape the diff renderer expects. Pure
// data work with no browser, so it is unit-tested.
import {
  type CodeViewDiffItem,
  type CodeViewLineScrollTarget,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type Hunk,
  parsePatchFiles,
} from "@pierre/diffs";
import type { Comment, DiffModel, Step } from "@codethrough/schema";

// Which side of the diff a line is on: the new code or the old code.
type AnnotationSide = "additions" | "deletions";

// A step or comment pinned to one diff line. Comments fill in author and replies;
// steps leave those empty and put the step title in label.
interface ReviewAnnotation {
  id: string;
  path: string;
  side: AnnotationSide;
  lineNumber: number;
  kind: "step" | "comment";
  label: string;
  author?: string;
  replies?: Comment[];
}

// The data we hand to the diff renderer for each line. It reads this to build the
// element to show.
interface AnnotationMeta {
  id: string;
  kind: "step" | "comment";
  label: string;
  author?: string;
  replies?: Comment[];
}

// One file in the diff, with our line annotations attached.
type ReviewCodeViewItem = CodeViewDiffItem<AnnotationMeta>;

type StepLike = Step;

// Pin each line comment to its diff line. File-level and outdated comments are
// skipped here; they go in the side list instead.
const commentAnnotations = (comments: Comment[]): ReviewAnnotation[] =>
  comments
    .filter((comment) => comment.placement.kind === "line")
    .map((comment) => {
      // The filter above guarantees this is a line comment with side and line.
      const placement = comment.placement as Extract<Comment["placement"], { kind: "line" }>;
      return {
        id: comment.id,
        path: comment.path,
        side: placement.side,
        lineNumber: placement.lineNumber,
        kind: "comment" as const,
        label: comment.body,
      };
    });

// Like commentAnnotations, but also attaches the author and replies so the diff
// shows the full thread. Replies come keyed by their parent comment id.
const lineCommentAnnotations = (
  lineComments: Comment[],
  repliesByParentId: Map<string, Comment[]>,
): ReviewAnnotation[] =>
  lineComments
    .filter((comment) => comment.placement.kind === "line")
    .map((comment) => {
      const placement = comment.placement as Extract<Comment["placement"], { kind: "line" }>;
      return {
        id: comment.id,
        path: comment.path,
        side: placement.side,
        lineNumber: placement.lineNumber,
        kind: "comment" as const,
        label: comment.body,
        author: comment.author,
        replies: repliesByParentId.get(comment.id) ?? [],
      };
    });

// Find the diff line a step points at. Uses the step's line range if given, else
// the first changed line of its hunk. Returns undefined if the hunk is unknown,
// so callers can skip the step.
const resolveStepAnchor = (
  step: Step,
  diffModel: DiffModel,
): { path: string; side: AnnotationSide; lineNumber: number } | undefined => {
  const entries = hunkIndex(diffModel);
  const suffix = Number.parseInt(step.hunkId.replace(/^h/, ""), 10);
  const entry = Number.isInteger(suffix) ? entries[suffix] : undefined;
  if (entry === undefined) {
    return undefined;
  }
  const onAdditions = entry.hunk.additionCount > 0;
  const start = onAdditions ? entry.hunk.additionStart : entry.hunk.deletionStart;
  const count = onAdditions ? entry.hunk.additionCount : entry.hunk.deletionCount;
  const wanted = step.lineRange && step.lineRange.length > 0 ? step.lineRange[0]! : start;
  const lineNumber = Math.min(Math.max(wanted, start), start + count - 1);
  return { path: entry.path, side: onAdditions ? "additions" : "deletions", lineNumber };
};

// Turn steps into line highlights. The id is the step's position (step-0,
// step-1, ...) so the panel can mark the active one. Steps that do not map to a
// known line are dropped.
const stepAnnotations = (steps: Step[], diffModel: DiffModel): ReviewAnnotation[] => {
  const annotations: ReviewAnnotation[] = [];
  steps.forEach((step, index) => {
    const anchor = resolveStepAnchor(step, diffModel);
    if (anchor === undefined) {
      return;
    }
    annotations.push({
      id: `step-${index}`,
      path: anchor.path,
      side: anchor.side,
      lineNumber: anchor.lineNumber,
      kind: "step",
      label: step.title,
    });
  });
  return annotations;
};

// Group annotations by file path, ready for the diff renderer.
const annotationsByPath = (
  annotations: ReviewAnnotation[],
): Map<string, DiffLineAnnotation<AnnotationMeta>[]> => {
  const grouped = new Map<string, DiffLineAnnotation<AnnotationMeta>[]>();
  for (const annotation of annotations) {
    const list = grouped.get(annotation.path) ?? [];
    // Only set the optional fields when they exist; the types reject undefined.
    const metadata: AnnotationMeta = {
      id: annotation.id,
      kind: annotation.kind,
      label: annotation.label,
    };
    if (annotation.author !== undefined) {
      metadata.author = annotation.author;
    }
    if (annotation.replies !== undefined) {
      metadata.replies = annotation.replies;
    }
    list.push({ side: annotation.side, lineNumber: annotation.lineNumber, metadata });
    grouped.set(annotation.path, list);
  }
  return grouped;
};

// Parse the raw diff and build one render item per file, each with its
// annotations.
const toCodeViewItems = (
  diffModel: DiffModel,
  annotations: ReviewAnnotation[],
): ReviewCodeViewItem[] => {
  const patches = parsePatchFiles(diffModel.rawDiff, "review");
  const files: FileDiffMetadata[] = patches.flatMap((patch) => patch.files);
  const grouped = annotationsByPath(annotations);
  return files.map((fileDiff) => ({
    id: fileDiff.name,
    type: "diff",
    fileDiff,
    annotations: grouped.get(fileDiff.name) ?? [],
  }));
};

// Where to scroll so this annotation's line sits centered in view.
const scrollTargetFor = (annotation: ReviewAnnotation): CodeViewLineScrollTarget => ({
  type: "line",
  id: annotation.path,
  lineNumber: annotation.lineNumber,
  side: annotation.side,
  align: "center",
});

// Same as scrollTargetFor, named for the step navigation call site.
const scrollTargetForStep = (annotation: ReviewAnnotation): CodeViewLineScrollTarget =>
  scrollTargetFor(annotation);

const rowKey = (path: string, side: AnnotationSide, lineNumber: number): string =>
  `${path} ${side} ${lineNumber}`;

// List every line the diff actually shows, keyed by file, side, and line number.
// We use this to find comments whose line is not shown, which would otherwise
// just vanish.
const renderedRowKeys = (diffModel: DiffModel): Set<string> => {
  const keys = new Set<string>();
  const patches = parsePatchFiles(diffModel.rawDiff, "review");
  for (const patch of patches) {
    for (const file of patch.files) {
      for (const hunk of file.hunks) {
        const additionEnd = hunk.additionStart + hunk.additionCount;
        for (let line = hunk.additionStart; line < additionEnd; line++) {
          keys.add(rowKey(file.name, "additions", line));
        }
        const deletionEnd = hunk.deletionStart + hunk.deletionCount;
        for (let line = hunk.deletionStart; line < deletionEnd; line++) {
          keys.add(rowKey(file.name, "deletions", line));
        }
      }
    }
  }
  return keys;
};

// One hunk plus the file it belongs to.
interface HunkEntry {
  path: string;
  hunk: Hunk;
}

// Every hunk in the diff, in order. A step names its hunk by position (h0, h1,
// ...), which is the index into this list.
const hunkIndex = (diffModel: DiffModel): HunkEntry[] => {
  const patches = parsePatchFiles(diffModel.rawDiff, "review");
  const entries: HunkEntry[] = [];
  for (const patch of patches) {
    for (const file of patch.files) {
      for (const hunk of file.hunks) {
        entries.push({ path: file.name, hunk });
      }
    }
  }
  return entries;
};

// Split annotations into ones whose line is shown in the diff and ones whose line
// is not. The hidden ones go to the side list so they are not lost.
const partitionAnnotations = (
  diffModel: DiffModel,
  annotations: ReviewAnnotation[],
): { placeable: ReviewAnnotation[]; unplaceable: ReviewAnnotation[] } => {
  const present = renderedRowKeys(diffModel);
  const placeable: ReviewAnnotation[] = [];
  const unplaceable: ReviewAnnotation[] = [];
  for (const annotation of annotations) {
    if (present.has(rowKey(annotation.path, annotation.side, annotation.lineNumber))) {
      placeable.push(annotation);
    } else {
      unplaceable.push(annotation);
    }
  }
  return { placeable, unplaceable };
};

export {
  commentAnnotations,
  hunkIndex,
  lineCommentAnnotations,
  partitionAnnotations,
  resolveStepAnchor,
  scrollTargetFor,
  scrollTargetForStep,
  stepAnnotations,
  toCodeViewItems,
};
export type {
  AnnotationMeta,
  AnnotationSide,
  HunkEntry,
  ReviewAnnotation,
  ReviewCodeViewItem,
  StepLike,
};
