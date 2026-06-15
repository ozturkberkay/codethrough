// Test harness: render the diff with the fixture and expose hooks so the tests can
// wait for it and switch the active step.
import "virtual:uno.css";
import { createSignal, onMount } from "solid-js";
import { render } from "solid-js/web";
import { DiffView } from "../diff_view.js";
import { partitionAnnotations, type ReviewAnnotation } from "../annotations.js";
import { FIXTURE_ANNOTATIONS, FIXTURE_DIFF } from "./fixture.js";

const Harness = () => {
  const [activeStep, setActiveStep] = createSignal<ReviewAnnotation | undefined>();

  // Pass every annotation in, including the out-of-range one, to prove the diff
  // copes. Expose which ones are off-diff so the test can check them.
  const { unplaceable } = partitionAnnotations(FIXTURE_DIFF, FIXTURE_ANNOTATIONS);

  onMount(() => {
    globalThis.__unplaceableIds = unplaceable.map((annotation) => annotation.id);
    globalThis.__setActiveStep = (id: string): void => {
      const match = FIXTURE_ANNOTATIONS.find((annotation) => annotation.id === id);
      setActiveStep(match);
    };
    // Wait a couple of frames so highlighting and layout finish first.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        globalThis.__ready = true;
      }),
    );
  });

  return (
    <div class="p-2 font-mono">
      <h1 data-testid="title" class="mb-2 text-lg">
        @codethrough/review harness
      </h1>
      <DiffView diff={FIXTURE_DIFF} annotations={FIXTURE_ANNOTATIONS} activeStep={activeStep} />
    </div>
  );
};

const root = document.getElementById("root");
if (root) {
  const dispose = render(() => <Harness />, root);
  // Expose teardown so the test can confirm cleanup runs without error.
  globalThis.__dispose = dispose;
}
