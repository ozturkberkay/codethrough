// Lays out the whole review screen: header, summary, error banner, step nav,
// diff, side comments, write panel, copy button, and footer. Just rendering; the
// state is passed in. Covered by end-to-end tests.
//
// It pulls in every panel, so the import-count rule is turned off here.
/* oxlint-disable import/max-dependencies */
import { Show } from "solid-js";
import type { DiffModel, ReviewMeta } from "@codethrough/schema";
import { DiffView } from "./diff_view.js";
import { errorTitle } from "./error_banner.js";
import { GeneralComments } from "./general_comments.js";
import type { ReviewState } from "./review_state.js";
import { SummaryPanel } from "./summary_panel.js";
import { formatUsageFooter } from "./usage_footer.js";
import { WalkthroughPanel } from "./walkthrough_panel.js";
import { WritePanel } from "./write_panel.js";

interface ReviewLayoutProps {
  meta: ReviewMeta;
  diff: DiffModel;
  state: ReviewState;
}

// Shown only when the walkthrough failed. This is a different state from a
// walkthrough that finished with no steps.
const ErrorBanner = (props: { state: ReviewState }) => (
  <Show when={props.state.error()}>
    {(error) => (
      <div
        data-testid="walkthrough-error"
        class="flex flex-col gap-1 rounded border border-rose-700 bg-rose-950/40 p-3 text-rose-200"
      >
        <p data-testid="walkthrough-error-title" class="m-0 font-medium">
          {errorTitle(error().kind)}
        </p>
        <p class="m-0 text-sm text-rose-300">{error().message}</p>
      </div>
    )}
  </Show>
);

// Cost, elapsed time, and token counts for the run. Elapsed time always shows so
// the run looks like it is making progress.
const UsageFooter = (props: { state: ReviewState }) => (
  <footer
    data-testid="usage-footer"
    class="self-start rounded bg-zinc-800 px-3 py-1 font-mono text-xs text-zinc-300"
  >
    {formatUsageFooter(props.state.usage(), props.state.elapsedSeconds())}
  </footer>
);

// The copy button, plus a hidden element holding the copied text so tests can
// read it without the clipboard.
const CopyAction = (props: { copied: () => string; onCopy: () => void }) => (
  <div class="flex flex-col gap-2">
    <button
      type="button"
      data-testid="copy-markdown"
      class="self-start rounded border border-zinc-600 bg-zinc-800 px-3 py-1 text-zinc-100 kbd-focus"
      onClick={() => props.onCopy()}
    >
      Copy as Markdown
    </button>
    <Show when={props.copied()}>
      <pre data-testid="markdown-output" class="hidden">
        {props.copied()}
      </pre>
    </Show>
  </div>
);

const ReviewLayout = (props: ReviewLayoutProps) => (
  <div data-testid="review" class="flex flex-col gap-4 p-4 text-zinc-100">
    <header class="flex flex-col gap-1">
      <h1 data-testid="review-title" class="m-0 text-xl">
        {props.meta.title}
      </h1>
      <Show when={props.meta.author}>
        {(author) => <span class="text-sm text-zinc-400">by {author()}</span>}
      </Show>
    </header>

    <SummaryPanel
      summary={props.state.summary}
      done={props.state.done}
      stepCount={() => props.state.steps().length}
      hasError={() => props.state.error() !== null}
    />

    <ErrorBanner state={props.state} />

    <WalkthroughPanel
      steps={props.state.steps}
      activeIndex={props.state.activeIndex}
      onPrev={props.state.onPrev}
      onNext={props.state.onNext}
    />

    <DiffView
      diff={props.diff}
      annotations={props.state.lineAnnotations()}
      activeStep={props.state.activeAnnotation}
    />

    <GeneralComments
      generalByPath={() => props.state.groups().generalByPath}
      prGeneral={() => props.state.groups().prGeneral}
      repliesByParentId={() => props.state.groups().repliesByParentId}
    />

    <WritePanel write={props.state.write} />

    <CopyAction copied={props.state.copied} onCopy={props.state.onCopy} />

    <UsageFooter state={props.state} />
  </div>
);

export { ReviewLayout };
export type { ReviewLayoutProps };
