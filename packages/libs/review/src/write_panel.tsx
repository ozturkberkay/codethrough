// The write UI: a comment composer, the list of pending drafts, and the submit
// control. Just rendering; the state is passed in. Hidden when the run cannot
// post comments. Covered by end-to-end tests.
import { type Accessor, createSignal, For, type Setter, Show } from "solid-js";
import type { ReviewEvent } from "@codethrough/schema";
import { buildFileDraft, buildLineDraft, type DraftSide } from "./comment_draft.js";
import type { WriteState } from "./write_state.js";

interface WritePanelProps {
  write: WriteState;
}

const FIELD = "rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-zinc-100 kbd-focus";
const BTN =
  "rounded border border-zinc-600 bg-zinc-800 px-3 py-1 text-zinc-100 kbd-focus disabled:opacity-50";
const LABEL = "m-0 text-sm uppercase tracking-wide text-zinc-400";

// A text input shared by the composer fields.
const TextField = (props: {
  testid: string;
  placeholder: string;
  value: Accessor<string>;
  onValue: Setter<string>;
  extraClass?: string;
}) => (
  <input
    data-testid={props.testid}
    class={`${FIELD} ${props.extraClass ?? ""}`}
    placeholder={props.placeholder}
    value={props.value()}
    onInput={(event) => props.onValue(event.currentTarget.value)}
  />
);

// The line number and new/old side picker for a line comment.
const TargetRow = (props: {
  line: Accessor<string>;
  setLine: Setter<string>;
  side: Accessor<DraftSide>;
  setSide: Setter<DraftSide>;
}) => (
  <div class="flex gap-2">
    <TextField
      testid="composer-line"
      placeholder="line"
      value={props.line}
      onValue={props.setLine}
      extraClass="w-24"
    />
    <select
      data-testid="composer-side"
      class={FIELD}
      value={props.side()}
      onChange={(event) => props.setSide(event.currentTarget.value as DraftSide)}
    >
      <option value="additions">new side</option>
      <option value="deletions">old side</option>
    </select>
  </div>
);

// The comment text box and its save button.
const ComposerBody = (props: {
  body: Accessor<string>;
  setBody: Setter<string>;
  disabled: () => boolean;
  onSave: () => void;
}) => (
  <>
    <textarea
      data-testid="composer-body"
      class={FIELD}
      placeholder="Leave a comment"
      rows={3}
      value={props.body()}
      onInput={(event) => props.setBody(event.currentTarget.value)}
    />
    <button
      type="button"
      data-testid="composer-save"
      class={`${BTN} self-start`}
      disabled={props.disabled()}
      onClick={() => props.onSave()}
    >
      Add draft
    </button>
  </>
);

// The composer. With a line, it drafts a comment on that line; without one, a
// file-level note. Saving needs both a path and some text.
const CommentComposer = (props: { write: WriteState }) => {
  const [body, setBody] = createSignal("");
  const [path, setPath] = createSignal("");
  const [line, setLine] = createSignal("");
  const [side, setSide] = createSignal<DraftSide>("additions");

  // Save the draft, then clear the text and line for the next one.
  const onSave = async (): Promise<void> => {
    const lineNumber = Number.parseInt(line(), 10);
    const draft = Number.isInteger(lineNumber)
      ? buildLineDraft({ path: path(), side: side(), lineNumber, body: body() })
      : buildFileDraft(path(), body());
    await props.write.addDraft(draft);
    setBody("");
    setLine("");
  };

  const disabled = (): boolean =>
    !props.write.canWrite() || body().trim() === "" || path().trim() === "";

  return (
    <div
      data-testid="comment-composer"
      class="flex flex-col gap-2 rounded border border-zinc-700 p-3"
    >
      <h3 class={LABEL}>Add a comment</h3>
      <TextField
        testid="composer-path"
        placeholder="path (e.g. src/a.ts)"
        value={path}
        onValue={setPath}
      />
      <TargetRow line={line} setLine={setLine} side={side} setSide={setSide} />
      <ComposerBody
        body={body}
        setBody={setBody}
        disabled={disabled}
        onSave={() => void onSave()}
      />
    </div>
  );
};

// The pending drafts, so the reviewer sees what a submit will post.
const DraftList = (props: { write: WriteState }) => (
  <Show when={props.write.drafts().length > 0}>
    <div data-testid="draft-list" class="flex flex-col gap-2">
      <h3 class={LABEL}>Pending drafts ({props.write.drafts().length})</h3>
      <For each={props.write.drafts()}>
        {(draft) => (
          <div data-pending-draft class="rounded bg-zinc-800 p-2 text-sm">
            <span data-draft-target class="text-xs text-zinc-400">
              {draft.path}
              {draft.line === null ? " (file)" : `:${draft.line}`}
            </span>
            <p data-draft-body class="m-0 whitespace-pre-wrap text-zinc-100">
              {draft.body}
            </p>
          </div>
        )}
      </For>
    </div>
  </Show>
);

// Shows whether the submit succeeded or failed.
const SubmitStatusLine = (props: { write: WriteState }) => (
  <>
    <Show when={props.write.submitStatus() === "submitted"}>
      <p data-testid="submit-success" class="m-0 text-emerald-300">
        Review submitted.
      </p>
    </Show>
    <Show when={props.write.submitStatus() === "error"}>
      <p data-testid="submit-error" class="m-0 text-rose-300">
        Submit failed: {props.write.submitError()}
      </p>
    </Show>
  </>
);

// The submit form: pick approve/comment/changes, add an optional note, submit.
const SubmitForm = (props: { write: WriteState }) => {
  const [event, setEvent] = createSignal<ReviewEvent>("COMMENT");
  const [body, setBody] = createSignal("");

  const onSubmit = (): void => {
    const review = body().trim() === "" ? { event: event() } : { event: event(), body: body() };
    void props.write.submit(review);
  };

  return (
    <>
      <select
        data-testid="submit-event"
        class={FIELD}
        value={event()}
        onChange={(changeEvent) => setEvent(changeEvent.currentTarget.value as ReviewEvent)}
      >
        <option value="COMMENT">Comment</option>
        <option value="APPROVE">Approve</option>
        <option value="REQUEST_CHANGES">Request changes</option>
      </select>
      <textarea
        data-testid="submit-body"
        class={FIELD}
        placeholder="Overall review comment (optional)"
        rows={2}
        value={body()}
        onInput={(inputEvent) => setBody(inputEvent.currentTarget.value)}
      />
      <button
        type="button"
        data-testid="submit-button"
        class={`${BTN} self-start`}
        disabled={props.write.submitStatus() === "submitting"}
        onClick={onSubmit}
      >
        Submit review
      </button>
      <SubmitStatusLine write={props.write} />
    </>
  );
};

// The submit control: the form when the run can post comments, else a note saying
// it cannot.
const SubmitReview = (props: { write: WriteState }) => (
  <div data-testid="submit-review" class="flex flex-col gap-2 rounded border border-zinc-700 p-3">
    <h3 class={LABEL}>Submit review</h3>
    <Show
      when={props.write.canWrite()}
      fallback={
        <p data-testid="write-unavailable" class="m-0 text-zinc-500">
          Comments are unavailable for this run.
        </p>
      }
    >
      <SubmitForm write={props.write} />
    </Show>
  </div>
);

// The full write panel: composer, pending drafts, then the submit control.
const WritePanel = (props: WritePanelProps) => (
  <section data-testid="write-panel" class="flex flex-col gap-4 rounded border border-zinc-700 p-4">
    <h2 class={LABEL}>Review</h2>
    <CommentComposer write={props.write} />
    <DraftList write={props.write} />
    <SubmitReview write={props.write} />
  </section>
);

export { WritePanel };
export type { WritePanelProps };
