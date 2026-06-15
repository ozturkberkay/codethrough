// The top-level review screen. Thin on purpose: it builds the state and hands it
// to the layout. Covered by end-to-end tests.
import { Show } from "solid-js";
import type { ReviewDataSource } from "@codethrough/schema";
import { createReviewState } from "./review_state.js";
import { ReviewLayout } from "./review_layout.js";

interface ReviewProps {
  source: ReviewDataSource;
  // Called with the copied Markdown, so tests can read it without the clipboard.
  onCopy?: (markdown: string) => void;
}

const Review = (props: ReviewProps) => {
  const state = createReviewState(props.source, props.onCopy);

  return (
    <Show
      when={state.data()}
      fallback={
        <p data-testid="review-loading" class="p-4 text-zinc-400">
          Loading review...
        </p>
      }
    >
      {(loaded) => <ReviewLayout meta={loaded().meta} diff={loaded().diff} state={state} />}
    </Show>
  );
};

export { Review };
export type { ReviewProps };
