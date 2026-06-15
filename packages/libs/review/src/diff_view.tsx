// Renders the diff using the third-party diff library. It needs a real browser,
// so this is covered by end-to-end tests, not unit tests.
import { CodeView } from "@pierre/diffs";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import { createEffect, onCleanup, onMount } from "solid-js";
import { renderAnnotation } from "./annotation_node.js";
import { type ReviewAnnotation, scrollTargetFor, toCodeViewItems } from "./annotations.js";
import type { DiffModel } from "@codethrough/schema";

const THEME = "pierre-dark";
const POOL_SIZE = 2;

interface DiffViewProps {
  diff: DiffModel;
  annotations: ReviewAnnotation[];
  // When the active step changes, scroll the diff to it.
  activeStep?: () => ReviewAnnotation | undefined;
}

// Starts the background worker that highlights the code.
const workerFactory = (): Worker =>
  new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" });

// Set up the diff renderer in the host element and return a teardown function.
const mountCodeView = (host: HTMLElement, props: DiffViewProps): (() => void) => {
  const worker = new WorkerPoolManager({ workerFactory, poolSize: POOL_SIZE }, { theme: THEME });
  const codeView = new CodeView({ theme: THEME, renderAnnotation }, worker);

  codeView.setup(host);
  codeView.setItems(toCodeViewItems(props.diff, props.annotations));
  codeView.render(true);

  // Scroll to the active step whenever it changes.
  createEffect(() => {
    const annotation = props.activeStep?.();
    if (annotation) {
      codeView.scrollTo(scrollTargetFor(annotation));
    }
  });

  return () => {
    codeView.cleanUp();
    worker.terminate();
  };
};

// Renders the diff with our comments and step highlights on their lines, and
// cleans up when the view goes away.
const DiffView = (props: DiffViewProps) => {
  const setHost = (host: HTMLDivElement): void => {
    onMount(() => onCleanup(mountCodeView(host, props)));
  };

  return (
    <div
      ref={setHost}
      data-testid="diff-view"
      class="h-[420px] overflow-auto border border-zinc-700"
    />
  );
};

export { DiffView };
export type { DiffViewProps };
