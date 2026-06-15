// Tests for PR ingest. The client is a tiny fake, so the meta mapping and the
// diff-as-string behaviour run with no network. The fake records its call params
// so we can check the pull number and the diff request.

import { parse } from "valibot";
import { describe, expect, it } from "vitest";

import { ReviewMeta } from "@codethrough/schema";

import { fetchPrDiff, fetchPrMeta, type PrPullsClient } from "../../src/pr_ingest.js";

const REF = { owner: "octo", repo: "demo", number: 42 };

// A sample pulls.get payload with just the fields we map.
const pullData = {
  title: "Add the thing",
  body: "Why we add the thing.",
  html_url: "https://github.com/octo/demo/pull/42",
  base: { ref: "main", sha: "basesha111" },
  head: { ref: "feature", sha: "headsha222" },
  user: { login: "octocat" },
};

// Build a fake client. `diff` is what a diff request returns; every call records
// its params into `calls`.
const fakeClient = (
  data: unknown,
  diff: string,
  calls: Record<string, unknown>[],
): PrPullsClient => ({
  rest: {
    pulls: {
      // Return the diff string for a diff request and the JSON otherwise, like
      // the real octokit.
      get: async (params) => {
        calls.push(params);
        const isDiff = params.mediaType?.format === "diff";
        return { data: (isDiff ? diff : data) as never };
      },
    },
  },
});

describe("fetchPrMeta", () => {
  it("maps the pulls.get payload to a schema-valid ReviewMeta", async () => {
    const calls: Record<string, unknown>[] = [];
    const result = await fetchPrMeta(fakeClient(pullData, "", calls), REF);

    expect(result.meta).toEqual({
      title: "Add the thing",
      body: "Why we add the thing.",
      repoOwner: "octo",
      repoName: "demo",
      number: 42,
      baseRef: "main",
      headRef: "feature",
      author: "octocat",
      url: "https://github.com/octo/demo/pull/42",
    });
    // The mapping passes schema validation (throws on mismatch).
    expect(parse(ReviewMeta, result.meta)).toEqual(result.meta);
  });

  it("returns the head and base commit oids", async () => {
    const result = await fetchPrMeta(fakeClient(pullData, "", []), REF);
    expect(result.headRefOid).toBe("headsha222");
    expect(result.baseRefOid).toBe("basesha111");
  });

  it("maps the ref number to pull_number", async () => {
    const calls: Record<string, unknown>[] = [];
    await fetchPrMeta(fakeClient(pullData, "", calls), REF);
    expect(calls[0]).toMatchObject({ owner: "octo", repo: "demo", pull_number: 42 });
    expect(calls[0]?.["mediaType"]).toBeUndefined();
  });

  it("defaults a null body to an empty string", async () => {
    const result = await fetchPrMeta(fakeClient({ ...pullData, body: null }, "", []), REF);
    expect(result.meta.body).toBe("");
  });

  it("maps a null user to a null author", async () => {
    const result = await fetchPrMeta(fakeClient({ ...pullData, user: null }, "", []), REF);
    expect(result.meta.author).toBeNull();
  });
});

describe("fetchPrDiff", () => {
  const rawDiff = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;

  it("returns the unified diff string from a diff-format request", async () => {
    const diff = await fetchPrDiff(fakeClient(pullData, rawDiff, []), REF);
    expect(diff).toBe(rawDiff);
  });

  it("requests the diff mediaType with the right pull coordinates", async () => {
    const calls: Record<string, unknown>[] = [];
    await fetchPrDiff(fakeClient(pullData, rawDiff, calls), REF);
    expect(calls[0]).toMatchObject({
      owner: "octo",
      repo: "demo",
      pull_number: 42,
      mediaType: { format: "diff" },
    });
  });
});
