// The summary panel: problem, status quo, solution, and key decisions. Shows a
// "generating" message until the summary arrives, and a note when the walkthrough
// finished with no steps. Covered by end-to-end tests.
import { For, Show } from "solid-js";
import type { Summary } from "@codethrough/schema";

interface SummaryPanelProps {
  // The summary, or null until it arrives.
  summary: () => Summary | null;
  // True once the walkthrough has finished.
  done: () => boolean;
  // How many steps were produced, used to spot a no-step result.
  stepCount: () => number;
  // True when the walkthrough failed. The no-step note is hidden then, since the
  // error banner shows the failure instead.
  hasError: () => boolean;
}

// One labelled paragraph block in the summary.
const Field = (props: { label: string; value: string }) => (
  <div class="flex flex-col gap-1">
    <h3 class="m-0 text-xs uppercase tracking-wide text-zinc-400">{props.label}</h3>
    <p class="m-0 whitespace-pre-wrap text-zinc-100">{props.value}</p>
  </div>
);

const SummaryPanel = (props: SummaryPanelProps) => (
  <section
    data-testid="summary-panel"
    class="flex flex-col gap-3 rounded border border-zinc-700 p-4"
  >
    <Show
      when={props.summary()}
      fallback={
        <p data-testid="summary-generating" class="m-0 text-zinc-400">
          Generating summary...
        </p>
      }
    >
      {(summary) => (
        <>
          <Field label="Problem" value={summary().problem} />
          <Field label="Status quo" value={summary().statusQuo} />
          <Field label="Solution" value={summary().solution} />
          <div class="flex flex-col gap-1">
            <h3 class="m-0 text-xs uppercase tracking-wide text-zinc-400">Key decisions</h3>
            <ul class="m-0 flex flex-col gap-1 pl-5 text-zinc-100">
              <For each={summary().keyDecisions}>{(decision) => <li>{decision}</li>}</For>
            </ul>
          </div>
        </>
      )}
    </Show>
    <Show when={props.done() && props.stepCount() === 0 && !props.hasError()}>
      <p data-testid="thin-result" class="m-0 text-amber-300">
        No steps were produced for this walkthrough.
      </p>
    </Show>
  </section>
);

export { SummaryPanel };
export type { SummaryPanelProps };
