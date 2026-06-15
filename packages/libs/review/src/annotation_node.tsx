// Builds the element the diff shows on one line: a step highlight or a comment
// thread. Browser-only, so it is covered by end-to-end tests, not unit tests.
import type { DiffLineAnnotation, LineAnnotation } from "@pierre/diffs";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { AnnotationMeta } from "./annotations.js";
import { CommentThread } from "./comment_thread.js";

// A clickable highlight for one step. The click counter is here to prove the
// element stays interactive once placed in the diff.
const StepNode = (props: { label: string }) => {
  const [count, setCount] = createSignal(0);
  return (
    <button
      type="button"
      data-solid="1"
      class="rounded bg-amber-700/40 px-2 py-1 text-left text-amber-100 kbd-focus"
      onClick={() => setCount(count() + 1)}
    >
      <span data-kind-label>step</span>: {props.label}
      <span data-count> ({count()})</span>
    </button>
  );
};

const renderAnnotation = (
  annotation: LineAnnotation<AnnotationMeta> | DiffLineAnnotation<AnnotationMeta>,
): HTMLElement | undefined => {
  const meta = annotation.metadata;
  if (!meta) {
    return undefined;
  }
  const side = "side" in annotation ? annotation.side : "n/a";
  const mount = document.createElement("div");
  mount.className = "review-annotation px-2 py-1 text-sm";
  mount.dataset["annotationId"] = meta.id;
  mount.dataset["side"] = side;
  mount.dataset["line"] = String(annotation.lineNumber);
  mount.dataset["kind"] = meta.kind;

  if (meta.kind === "comment") {
    // Show the comment and its replies, read only.
    mount.dataset["solid"] = "1";
    render(
      () => (
        <CommentThread author={meta.author ?? ""} body={meta.label} replies={meta.replies ?? []} />
      ),
      mount,
    );
    return mount;
  }

  render(() => <StepNode label={meta.label} />, mount);
  return mount;
};

export { renderAnnotation };
