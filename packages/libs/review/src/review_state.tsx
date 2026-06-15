// The state behind the review screen. It loads the review, streams the
// walkthrough, and exposes everything the layout reads plus the nav handlers. The
// real logic lives in the pure helpers; this just wires them together. Covered by
// end-to-end tests.
//
// It pulls in many helpers, so the import-count rule is turned off here.
/* oxlint-disable import/max-dependencies */
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { ReviewData, ReviewDataSource, Step, Summary } from "@codethrough/schema";
import { lineCommentAnnotations, type ReviewAnnotation, stepAnnotations } from "./annotations.js";
import { groupComments, type GroupedComments } from "./comment_groups.js";
import { walkthroughToMarkdown } from "./markdown.js";
import { nextIndex, prevIndex } from "./step_nav.js";
import {
  consumeWalkthrough,
  initialWalkthroughState,
  type WalkthroughError,
  type WalkthroughState,
  type WalkthroughUsage,
} from "./walkthrough_stream.js";
import { createWriteState, type WriteState } from "./write_state.js";

// Milliseconds per second, for the elapsed-time readout.
const MS_PER_SECOND = 1_000;
// How often the elapsed time updates while the walkthrough streams.
const ELAPSED_TICK_MS = 100;

// Everything the layout reads. All are getters so the view updates as data loads
// and the walkthrough streams in. write holds the comment and submit actions.
interface ReviewState {
  data: () => ReviewData | null;
  summary: () => Summary | null;
  steps: () => Step[];
  done: () => boolean;
  activeIndex: () => number;
  lineAnnotations: () => ReviewAnnotation[];
  activeAnnotation: () => ReviewAnnotation | undefined;
  groups: () => GroupedComments;
  copied: () => string;
  write: WriteState;
  // Token counts and cost, or null until they arrive.
  usage: () => WalkthroughUsage | null;
  // The failure, or null if the walkthrough succeeded.
  error: () => WalkthroughError | null;
  // Seconds the walkthrough has taken: ticking while it runs, frozen once it ends.
  elapsedSeconds: () => number;
  onPrev: () => void;
  onNext: () => void;
  onCopy: () => void;
}

// The empty groups used before the review loads.
const EMPTY_GROUPS: GroupedComments = {
  lineComments: [],
  generalByPath: new Map(),
  prGeneral: [],
  repliesByParentId: new Map(),
};

// Try to copy to the clipboard, ignoring failures.
const writeClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // The clipboard may be blocked; the on-page copy still has the text.
  }
};

// Resolve the active step to its diff line so the diff can scroll to it.
// Undefined until a step is active.
const makeActiveAnnotation =
  (data: () => ReviewData | null, activeIndex: () => number, steps: () => Step[]) =>
  (): ReviewAnnotation | undefined =>
    data() && activeIndex() >= 0
      ? stepAnnotations(steps(), data()!.diff)[activeIndex()]
      : undefined;

// Callbacks for loadAndStream: store the loaded review, handle each streamed
// state, and record the job id so it can be cancelled later.
interface StreamHandlers {
  onLoaded: (data: ReviewData) => void;
  onWalk: (state: WalkthroughState) => void;
  onJob: (jobId: string) => void;
}

// Load the review, then start and stream the walkthrough. onJob runs as soon as
// the job id is known so cleanup can cancel it.
const loadAndStream = async (source: ReviewDataSource, handlers: StreamHandlers): Promise<void> => {
  handlers.onLoaded(await source.getReview());
  const { jobId } = await source.startWalkthrough();
  handlers.onJob(jobId);
  await consumeWalkthrough(source, jobId, handlers.onWalk);
};

// The state a review session holds, created once.
interface ReviewSignals {
  data: () => ReviewData | null;
  setData: (data: ReviewData | null) => void;
  walk: () => WalkthroughState;
  setWalk: (state: WalkthroughState) => void;
  activeIndex: () => number;
  setActiveIndex: (update: number | ((prev: number) => number)) => void;
  copied: () => string;
  setCopied: (markdown: string) => void;
  write: WriteState;
}

// Create the session state.
const createReviewSignals = (source: ReviewDataSource): ReviewSignals => {
  const [data, setData] = createSignal<ReviewData | null>(null);
  const [walk, setWalk] = createSignal<WalkthroughState>(initialWalkthroughState());
  const [activeIndex, setActiveIndex] = createSignal(-1);
  const [copied, setCopied] = createSignal("");
  return {
    data,
    setData,
    walk,
    setWalk,
    activeIndex,
    setActiveIndex,
    copied,
    setCopied,
    write: createWriteState(source),
  };
};

// Build the copy-as-Markdown handler.
const makeCopyMarkdown =
  (signals: ReviewSignals, onCopy?: (markdown: string) => void) => (): void => {
    if (signals.data()) {
      const data = signals.data()!;
      const markdown = walkthroughToMarkdown(
        data.meta,
        signals.walk().summary,
        signals.walk().steps,
      );
      signals.setCopied(markdown);
      onCopy?.(markdown);
      void writeClipboard(markdown);
    }
  };

// Seed the comments, then store the review. Order matters: storing the review
// mounts the diff, which reads the comments once, so they must be set first.
const makeOnLoaded =
  (signals: ReviewSignals) =>
  (loaded: ReviewData): void => {
    signals.write.seedComments(loaded.comments);
    signals.setData(loaded);
  };

// Store each streamed state, and select the first step once steps start arriving.
const makeOnWalk =
  (signals: ReviewSignals) =>
  (state: WalkthroughState): void => {
    signals.setWalk(state);
    if (signals.activeIndex() < 0 && state.steps.length > 0) {
      signals.setActiveIndex(0);
    }
  };

// The elapsed-time readout plus a way to register the running job.
interface GenerationLifecycle {
  elapsedSeconds: () => number;
  // Record the job id so closing the view cancels it.
  registerJob: (jobId: string) => void;
}

// Run the elapsed-time ticker, and on cleanup stop it and cancel the job. The job
// costs money to run, so cancelling on close avoids paying for a view nobody sees.
const createGenerationLifecycle = (
  source: ReviewDataSource,
  isDone: () => boolean,
): GenerationLifecycle => {
  const startedAt = Date.now();
  const [now, setNow] = createSignal(startedAt);
  const timer = setInterval(() => {
    if (!isDone()) {
      setNow(Date.now());
    }
  }, ELAPSED_TICK_MS);
  let jobId: string | null = null;
  onCleanup(() => {
    clearInterval(timer);
    if (jobId !== null) {
      void source.cancelWalkthrough(jobId);
    }
  });
  return {
    elapsedSeconds: () => (now() - startedAt) / MS_PER_SECOND,
    registerJob: (id) => {
      jobId = id;
    },
  };
};

const createReviewState = (
  source: ReviewDataSource,
  onCopy?: (markdown: string) => void,
): ReviewState => {
  const signals = createReviewSignals(source);
  const { data, walk, activeIndex, setActiveIndex, copied, write } = signals;

  // The groups update whenever the comment list changes.
  const groups = createMemo<GroupedComments>(() =>
    data() ? groupComments(write.comments()) : EMPTY_GROUPS,
  );
  const steps = (): Step[] => walk().steps;
  const isDone = (): boolean => walk().status === "done" || walk().status === "error";
  const lifecycle = createGenerationLifecycle(source, isDone);

  onMount(
    () =>
      void loadAndStream(source, {
        onLoaded: makeOnLoaded(signals),
        onWalk: makeOnWalk(signals),
        onJob: lifecycle.registerJob,
      }),
  );

  return {
    data,
    summary: () => walk().summary,
    steps,
    done: isDone,
    activeIndex,
    lineAnnotations: () =>
      lineCommentAnnotations(groups().lineComments, groups().repliesByParentId),
    activeAnnotation: makeActiveAnnotation(data, activeIndex, steps),
    groups,
    copied,
    write,
    usage: () => walk().usage,
    error: () => walk().error,
    elapsedSeconds: lifecycle.elapsedSeconds,
    onPrev: () => setActiveIndex((index) => prevIndex(index, steps().length)),
    onNext: () => setActiveIndex((index) => nextIndex(index, steps().length)),
    onCopy: makeCopyMarkdown(signals, onCopy),
  };
};

export { createReviewState };
export type { ReviewState };
