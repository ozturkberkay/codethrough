// The side area for comments not tied to a visible line: file notes, outdated
// comments grouped per file, and PR-wide notes. Outdated comments are often the
// majority, so showing them here keeps most of the conversation visible. Covered
// by end-to-end tests.
import { For, Show } from "solid-js";
import type { Comment } from "@codethrough/schema";
import { CommentThread } from "./comment_thread.js";

interface GeneralCommentsProps {
  generalByPath: () => Map<string, Comment[]>;
  prGeneral: () => Comment[];
  repliesByParentId: () => Map<string, Comment[]>;
}

// One note shown as a read-only thread with its replies.
const GeneralComment = (props: { comment: Comment; replies: Comment[] }) => (
  <div data-general-comment data-comment-id={props.comment.id}>
    <CommentThread
      author={props.comment.author}
      body={props.comment.body}
      replies={props.replies}
    />
  </div>
);

const GeneralComments = (props: GeneralCommentsProps) => {
  const repliesFor = (comment: Comment): Comment[] =>
    props.repliesByParentId().get(comment.id) ?? [];
  const fileEntries = (): [string, Comment[]][] => [...props.generalByPath().entries()];
  const hasAny = (): boolean => fileEntries().length > 0 || props.prGeneral().length > 0;

  return (
    <section
      data-testid="general-comments"
      class="flex flex-col gap-4 rounded border border-zinc-700 p-4"
    >
      <h2 class="m-0 text-sm uppercase tracking-wide text-zinc-400">General comments</h2>
      <Show
        when={hasAny()}
        fallback={
          <p data-testid="general-empty" class="m-0 text-zinc-500">
            No general comments.
          </p>
        }
      >
        <For each={fileEntries()}>
          {([path, comments]) => (
            <div data-general-file={path} class="flex flex-col gap-2">
              <h3 class="m-0 font-mono text-xs text-zinc-300">{path}</h3>
              <For each={comments}>
                {(comment) => <GeneralComment comment={comment} replies={repliesFor(comment)} />}
              </For>
            </div>
          )}
        </For>
        <Show when={props.prGeneral().length > 0}>
          <div data-general-pr class="flex flex-col gap-2">
            <h3 class="m-0 text-xs text-zinc-300">Pull request</h3>
            <For each={props.prGeneral()}>
              {(comment) => <GeneralComment comment={comment} replies={repliesFor(comment)} />}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
};

export { GeneralComments };
export type { GeneralCommentsProps };
