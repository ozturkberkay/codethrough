// Public API of this package. Value exports first, then type-only exports (the
// compiler config requires the split).

export {
  CODETHROUGH_SERVICE,
  EncryptedFileStore,
  MacKeychainStore,
  SecretToolStore,
  WindowsCredStore,
  selectStore,
} from "./keychain.js";
export {
  DEFAULT_GITHUB_SCOPE,
  DEVICE_GRANT_TYPE,
  DeviceFlowClient,
  DeviceFlowError,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_TOKEN_URL,
  toStoredToken,
} from "./device_flow.js";
export { tryGhToken } from "./gh_reuse.js";
export { createGitHubClient } from "./octokit.js";
export { GITHUB_ACCOUNT, logout, resolveToken, status } from "./auth.js";
export { buildCommentDiffIndex, findRow } from "./comment_diff_index.js";
export { placeAll, placeComment, rowToDraftTarget } from "./comment_placement.js";
export { fetchReviewComments, loadPlacedComments } from "./comment_fetch.js";
export { submitReview, toCommentEntry, toCreateReviewParams } from "./review_submit.js";
export { parsePrUrl } from "./pr_url.js";
export { fetchPrDiff, fetchPrMeta } from "./pr_ingest.js";
export { buildDiffModel } from "./diff_model.js";
export { prepareRepoFromClone, prepareRepoFromLocal } from "./repo_acquire.js";
export { ingestLocal } from "./local_ingest.js";
export { cloneUrlFor, ingestPr } from "./ingest.js";

// Type-only exports.
export type { CommandRunner, RunResult } from "./command.js";
export type { SecretStore, SelectOptions } from "./keychain.js";
export type {
  DeviceCodeResponse,
  DeviceFlowAuthenticator,
  DeviceFlowOptions,
  StoredToken,
  TokenResponse,
} from "./device_flow.js";
export type { GhReuseDeps, GhReuseResult, TextFileReader } from "./gh_reuse.js";
export type { GitHubClient, GitHubClientDeps, OctokitCtor, OctokitLike } from "./octokit.js";
export type { AuthDeps, AuthStatus, ResolvedToken, TokenSource } from "./auth.js";
export type {
  CommentDiffIndex,
  DiffRow,
  DiffSide,
  RowAddress,
  RowKind,
} from "./comment_diff_index.js";
export type { PierreAnnotation, PierreSide } from "./comment_placement.js";
export type { GhReviewComment } from "./gh_review_comment.js";
export type { PaginatingOctokit } from "./comment_fetch.js";
export type {
  ReviewPullsClient,
  SubmitReviewPayload,
  SubmitReviewResult,
} from "./review_submit.js";
export type { PrRef } from "./pr_url.js";
export type { PrMetaResult, PrPullsClient } from "./pr_ingest.js";
export type {
  AcquiredRepo,
  CloneArgs,
  FileSystem,
  LocalArgs,
  RepoAcquireDeps,
} from "./repo_acquire.js";
export type { LocalIngestDeps, LocalIngestResult, LocalRange } from "./local_ingest.js";
export type { IngestDeps, IngestOptions, IngestResult } from "./ingest.js";
