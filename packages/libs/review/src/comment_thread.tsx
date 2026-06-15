// Shows a comment and its replies, read only. Used both on diff lines and in the
// side notes. Covered by end-to-end tests.
import { For, Show } from "solid-js";
import type { Comment } from "@codethrough/schema";

interface CommentThreadProps {
  author: string;
  body: string;
  replies: Comment[];
}

// One author and body block, shared by the top comment and each reply.
const CommentBody = (props: { author: string; body: string }) => (
  <div class="flex flex-col gap-1">
    <span data-comment-author class="text-xs text-zinc-400">
      {props.author}
    </span>
    <p data-comment-body class="m-0 whitespace-pre-wrap text-zinc-100">
      {props.body}
    </p>
  </div>
);

// The top comment, then its replies indented beneath it.
const CommentThread = (props: CommentThreadProps) => (
  <div data-comment-thread class="flex flex-col gap-2 rounded bg-zinc-800 p-2 text-sm">
    <CommentBody author={props.author} body={props.body} />
    <Show when={props.replies.length > 0}>
      <div class="flex flex-col gap-2 border-l border-zinc-600 pl-2">
        <For each={props.replies}>
          {(reply) => (
            <div data-comment-reply data-reply-id={reply.id}>
              <CommentBody author={reply.author} body={reply.body} />
            </div>
          )}
        </For>
      </div>
    </Show>
  </div>
);

export { CommentThread };
export type { CommentThreadProps };
