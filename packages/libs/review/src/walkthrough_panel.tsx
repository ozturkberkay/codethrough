// The step navigation panel: prev/next buttons, the position, and the active
// step's title and explanation. Steps appear as they stream in. Moving between
// steps also scrolls the diff. Covered by end-to-end tests.
import { Show } from "solid-js";
import type { Step } from "@codethrough/schema";
import { positionLabel } from "./step_nav.js";

interface WalkthroughPanelProps {
  steps: () => Step[];
  // The active step, or -1 when no steps have arrived yet.
  activeIndex: () => number;
  onPrev: () => void;
  onNext: () => void;
}

const NAV_BUTTON =
  "rounded border border-zinc-600 bg-zinc-800 px-3 py-1 text-zinc-100 kbd-focus disabled:opacity-50";

// The prev/next bar with the position. Buttons disable at the first and last step.
const NavBar = (props: WalkthroughPanelProps & { count: number }) => (
  <div class="flex items-center gap-3">
    <button
      type="button"
      data-testid="nav-prev"
      class={NAV_BUTTON}
      disabled={props.activeIndex() <= 0}
      onClick={() => props.onPrev()}
    >
      Prev
    </button>
    <span data-testid="nav-position" class="text-zinc-400 tabular-nums">
      {positionLabel(props.activeIndex(), props.count)}
    </span>
    <button
      type="button"
      data-testid="nav-next"
      class={NAV_BUTTON}
      disabled={props.activeIndex() >= props.count - 1}
      onClick={() => props.onNext()}
    >
      Next
    </button>
  </div>
);

// The active step's title + explanation.
const StepBody = (props: { step: Step }) => (
  <div class="flex flex-col gap-2">
    <h3 data-testid="step-title" class="m-0 text-zinc-100">
      {props.step.title}
    </h3>
    <p data-testid="step-explanation" class="m-0 whitespace-pre-wrap text-zinc-300">
      {props.step.explanation}
    </p>
  </div>
);

const WalkthroughPanel = (props: WalkthroughPanelProps) => {
  const count = (): number => props.steps().length;
  const active = (): Step | undefined => props.steps()[props.activeIndex()];

  return (
    <section
      data-testid="walkthrough-panel"
      class="flex flex-col gap-3 rounded border border-zinc-700 p-4"
    >
      <Show
        when={count() > 0}
        fallback={
          <p data-testid="walkthrough-empty" class="m-0 text-zinc-400">
            Generating walkthrough steps...
          </p>
        }
      >
        <NavBar
          steps={props.steps}
          activeIndex={props.activeIndex}
          onPrev={props.onPrev}
          onNext={props.onNext}
          count={count()}
        />
        <Show when={active()}>{(step) => <StepBody step={step()} />}</Show>
      </Show>
    </section>
  );
};

export { WalkthroughPanel };
export type { WalkthroughPanelProps };
