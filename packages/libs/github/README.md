# @codethrough/github

Everything Codethrough needs from GitHub without a `gh` install: OAuth-App
device-flow authentication, the OS credential store, an Octokit wrapper, PR
ingest, and the comment read, placement, and review-submit logic. `git` does the
diff and file reads; only PR metadata and comments use the GitHub API. The package
is factored so a future hosted SaaS reuses it unchanged behind the
`ReviewDataSource` seam: the CLI resolves a device-flow user token now, the SaaS
swaps in its own tokens later, and the same ingest and placement code serves both.

## Public API

- **Auth and tokens:** `resolveToken`, `status`, `logout`, `GITHUB_ACCOUNT`,
  `tryGhToken` (the `gh` reuse fast path), the `DeviceFlowClient` and its
  `DeviceFlowError`, `toStoredToken`, `DEFAULT_GITHUB_SCOPE`, and the device-flow
  URL and grant-type constants.
- **Credential store:** `selectStore` (picks the per-OS backend) plus the
  `MacKeychainStore`, `SecretToolStore`, `WindowsCredStore`, and `EncryptedFileStore`
  implementations, and `CODETHROUGH_SERVICE`.
- **GitHub client:** `createGitHubClient`.
- **PR ingest:** `parsePrUrl`, `fetchPrMeta`, `fetchPrDiff`, `buildDiffModel`,
  `prepareRepoFromClone`, `prepareRepoFromLocal`, `cloneUrlFor`, `ingestPr`, and
  `ingestLocal`.
- **Comments:** `fetchReviewComments` and `loadPlacedComments` (paginate then
  aggregate), the placement engine (`buildCommentDiffIndex`, `findRow`, `placeAll`,
  `placeComment`, `rowToDraftTarget`), and the review-submit helpers (`submitReview`,
  `toCommentEntry`, `toCreateReviewParams`).
