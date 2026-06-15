// Fetch a pull request's metadata and its diff via octokit. The client is passed
// in so both calls can be tested with a tiny fake and no network.
//
// Asking for the "diff" format makes octokit return the diff as a plain string at
// runtime, even though its type still says the PR object. We narrow it below.

import type { ReviewMeta } from "@codethrough/schema";

import type { PrRef } from "./pr_url.js";

// The params for pulls.get. The index signature lets the real octokit client
// match this shape; the optional mediaType asks for the diff instead of JSON.
interface PullsGetParams {
  owner: string;
  repo: string;
  pull_number: number;
  mediaType?: { format: "diff" };
  [key: string]: unknown;
}

// The fields from the pulls.get response we map to ReviewMeta. The real response
// has more.
interface PullData {
  title: string;
  body: string | null;
  html_url: string;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  user: { login: string } | null;
}

// The small slice of octokit we use: a pulls.get whose response has the PR JSON
// on `.data`. The real client matches this (checked by a type test).
interface PrPullsClient {
  rest: {
    pulls: {
      get: (params: PullsGetParams) => Promise<{ data: PullData }>;
    };
  };
}

// Build the pulls.get params from a PR ref.
const getParams = (ref: PrRef): PullsGetParams => ({
  owner: ref.owner,
  repo: ref.repo,
  pull_number: ref.number,
});

// The metadata plus the base and head commit ids. The head id is what we check
// out; the base id bounds local diffs.
interface PrMetaResult {
  meta: ReviewMeta;
  headRefOid: string;
  baseRefOid: string;
}

// Map the PR JSON to ReviewMeta. body is "" when GitHub returns null (the schema
// wants a string); author is null when the PR has no user.
const toReviewMeta = (ref: PrRef, data: PullData): ReviewMeta => ({
  title: data.title,
  body: data.body ?? "",
  repoOwner: ref.owner,
  repoName: ref.repo,
  number: ref.number,
  baseRef: data.base.ref,
  headRef: data.head.ref,
  author: data.user?.login ?? null,
  url: data.html_url,
});

// Fetch PR metadata plus the base and head commit ids.
const fetchPrMeta = async (octokit: PrPullsClient, ref: PrRef): Promise<PrMetaResult> => {
  const { data } = await octokit.rest.pulls.get(getParams(ref));
  return {
    meta: toReviewMeta(ref, data),
    headRefOid: data.head.sha,
    baseRefOid: data.base.sha,
  };
};

// Fetch the PR's diff. The diff format returns the diff as a string at runtime
// even though the type says the PR object, so we narrow it to a string here.
const fetchPrDiff = async (octokit: PrPullsClient, ref: PrRef): Promise<string> => {
  const res = await octokit.rest.pulls.get({ ...getParams(ref), mediaType: { format: "diff" } });
  return res.data as unknown as string;
};

export { fetchPrDiff, fetchPrMeta };
export type { PrMetaResult, PrPullsClient };
