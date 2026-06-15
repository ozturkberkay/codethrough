import { array, type InferOutput, nullable, number, object, picklist, string } from "valibot";
import { Comment } from "./comment.js";
import { DiffModel } from "./diff.js";

/// What a submitted review does, matching GitHub's review event values.
export const ReviewEvent = picklist(["COMMENT", "APPROVE", "REQUEST_CHANGES"]);

export type ReviewEvent = InferOutput<typeof ReviewEvent>;

/// PR metadata. Repo, number, and url can be null when reviewing local files with
/// no GitHub PR behind them.
export const ReviewMeta = object({
  title: string(),
  body: string(),
  repoOwner: nullable(string()),
  repoName: nullable(string()),
  number: nullable(number()),
  baseRef: string(),
  headRef: string(),
  author: nullable(string()),
  url: nullable(string()),
});

export type ReviewMeta = InferOutput<typeof ReviewMeta>;

/// The session handle the review UI carries. `viewer` and `repo` are null when
/// reviewing local files with no GitHub.
export const ReviewContext = object({
  sessionId: string(),
  mode: picklist(["pr", "path"]),
  viewer: nullable(object({ login: string() })),
  repo: nullable(object({ owner: string(), name: string() })),
});

export type ReviewContext = InferOutput<typeof ReviewContext>;

/// Everything the review UI loads up front: PR metadata, the diff, and the
/// existing comments with their placements.
export const ReviewData = object({
  meta: ReviewMeta,
  diff: DiffModel,
  comments: array(Comment),
});

export type ReviewData = InferOutput<typeof ReviewData>;
