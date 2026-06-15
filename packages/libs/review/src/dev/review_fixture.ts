// A fake, in-memory data source for `bun run dev` and the end-to-end tests. It
// serves a multi-file diff, a mix of comments covering every layout case, and a
// walkthrough. The write side really stores drafts and clears them on submit, and
// it pushes one live comment shortly after the UI subscribes.
import type {
  Comment,
  CommentDelta,
  CommentDeltaListener,
  CommentDraft,
  ReviewData,
  ReviewDataSource,
  WalkthroughChunk,
} from "@codethrough/schema";
import { errorStream, fixtureStream } from "./review_chunks.js";
import { FIXTURE_DIFF } from "./fixture.js";

// Must match fixture.ts so grid.ts's last line is below the view.
const GRID_LINES = 40;

// Comments covering every case the UI must show: a line comment with a reply, a
// comment on a context line, a multi-line comment, an outdated comment, and a
// file note.
const FIXTURE_COMMENTS: Comment[] = [
  {
    id: "c-line",
    path: "src/greet.ts",
    body: "Was this console.log meant to ship?",
    author: "octocat",
    line: 3,
    originalLine: 3,
    side: "RIGHT",
    startLine: null,
    subjectType: "line",
    inReplyToId: null,
    placement: {
      kind: "line",
      strategy: "exact",
      side: "additions",
      lineNumber: 3,
      spanStartLine: null,
    },
  },
  {
    id: "c-line-reply",
    path: "src/greet.ts",
    body: "No, I will remove it.",
    author: "hubot",
    line: 3,
    originalLine: 3,
    side: "RIGHT",
    startLine: null,
    subjectType: "line",
    inReplyToId: "c-line",
    placement: {
      kind: "line",
      strategy: "exact",
      side: "additions",
      lineNumber: 3,
      spanStartLine: null,
    },
  },
  {
    id: "c-context",
    path: "src/math.ts",
    body: "Signature looks right.",
    author: "reviewer",
    line: 1,
    originalLine: 1,
    side: "RIGHT",
    startLine: null,
    subjectType: "line",
    inReplyToId: null,
    placement: {
      kind: "line",
      strategy: "anchored-additions",
      side: "additions",
      lineNumber: 1,
      spanStartLine: null,
    },
  },
  {
    id: "c-multiline",
    path: "src/grid.ts",
    body: "These five cells form the seed grid.",
    author: "reviewer",
    line: GRID_LINES,
    originalLine: GRID_LINES,
    side: "RIGHT",
    startLine: 1,
    subjectType: "line",
    inReplyToId: null,
    placement: {
      kind: "line",
      strategy: "exact",
      side: "additions",
      lineNumber: 5,
      spanStartLine: 1,
    },
  },
  {
    id: "c-outdated",
    path: "src/math.ts",
    body: "This used to subtract; the old code is gone now.",
    author: "octocat",
    line: null,
    originalLine: 42,
    side: "RIGHT",
    startLine: null,
    subjectType: "line",
    inReplyToId: null,
    placement: { kind: "general", strategy: "outdated-unplaceable" },
  },
  {
    id: "c-file-note",
    path: "src/greet.ts",
    body: "Consider splitting this module before it grows.",
    author: "maintainer",
    line: null,
    originalLine: null,
    side: "RIGHT",
    startLine: null,
    subjectType: "file",
    inReplyToId: null,
    placement: { kind: "general", strategy: "file-note" },
  },
];

const FIXTURE_REVIEW: ReviewData = {
  meta: {
    title: "Fix the adder and tidy greet",
    body: "Swap the operator and remove a stray log.",
    repoOwner: "octo",
    repoName: "demo",
    number: 7,
    baseRef: "main",
    headRef: "fix-adder",
    author: "octocat",
    url: "https://github.com/octo/demo/pull/7",
  },
  diff: FIXTURE_DIFF,
  comments: FIXTURE_COMMENTS,
};

// A comment the fake pushes after the UI subscribes, so the test can check it
// shows up without a reload.
const FIXTURE_LIVE_COMMENT: Comment = {
  id: "c-live",
  path: "src/math.ts",
  body: "A live comment that arrived after load.",
  author: "reviewer",
  line: null,
  originalLine: null,
  side: "RIGHT",
  startLine: null,
  subjectType: "file",
  inReplyToId: null,
  placement: { kind: "general", strategy: "file-note" },
};

// How long to wait before pushing the live comment: long enough that the first
// render settles, short enough that the test does not wait long.
const LIVE_DELTA_DELAY_MS = 150;

// What changes between source variants: the walkthrough stream and whether
// comments can be posted.
interface SourceVariant {
  stream: () => AsyncIterable<WalkthroughChunk>;
  commentsEnabled: boolean;
}

// Build a fake source for a variant. Reads return the fixtures and drafts are kept
// in memory. When comments are enabled it also pushes one live comment after a
// short delay; when disabled the write UI shows its fallback.
const makeVariantSource = (variant: SourceVariant): ReviewDataSource => {
  const drafts: CommentDraft[] = [];
  const base = {
    context: variant.commentsEnabled
      ? {
          sessionId: "dev-session",
          mode: "pr" as const,
          viewer: { login: "octocat" },
          repo: { owner: "octo", name: "demo" },
        }
      : { sessionId: "dev-session", mode: "path" as const, viewer: null, repo: null },
    getReview: async (): Promise<ReviewData> => await Promise.resolve(FIXTURE_REVIEW),
    startWalkthrough: async (): Promise<{ jobId: string }> =>
      await Promise.resolve({ jobId: "fixture-job" }),
    streamWalkthrough: (): AsyncIterable<WalkthroughChunk> => variant.stream(),
    cancelWalkthrough: async (): Promise<void> => await Promise.resolve(),
    listComments: async (): Promise<Comment[]> => await Promise.resolve(FIXTURE_COMMENTS),
    listDrafts: async (): Promise<CommentDraft[]> => await Promise.resolve([...drafts]),
    draftComment: async (draft: CommentDraft): Promise<void> => {
      drafts.push(draft);
      await Promise.resolve();
    },
    submitReview: async (): Promise<void> => {
      drafts.length = 0;
      await Promise.resolve();
    },
    capabilities: { comments: variant.commentsEnabled },
  };
  // Only a comments-enabled source offers live updates.
  if (!variant.commentsEnabled) {
    return base;
  }
  return {
    ...base,
    subscribeComments: (onDelta: CommentDeltaListener): (() => void) => {
      const delta: CommentDelta = { added: [FIXTURE_LIVE_COMMENT], updated: [], removed: [] };
      const timer = setTimeout(() => onDelta(delta), LIVE_DELTA_DELAY_MS);
      return () => clearTimeout(timer);
    },
  };
};

// The default source: full walkthrough, comments enabled.
const makeFixtureReviewSource = (): ReviewDataSource =>
  makeVariantSource({ stream: fixtureStream, commentsEnabled: true });

// A source whose walkthrough fails partway through.
const makeErrorReviewSource = (): ReviewDataSource =>
  makeVariantSource({ stream: errorStream, commentsEnabled: true });

// A source with comments disabled, so the write UI shows its fallback.
const makePathReviewSource = (): ReviewDataSource =>
  makeVariantSource({ stream: fixtureStream, commentsEnabled: false });

export {
  FIXTURE_COMMENTS,
  FIXTURE_LIVE_COMMENT,
  FIXTURE_REVIEW,
  makeErrorReviewSource,
  makeFixtureReviewSource,
  makePathReviewSource,
};
