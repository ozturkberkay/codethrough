import { parse } from "valibot";
import { describe, expect, it } from "vitest";
import { ReviewContext, ReviewData, ReviewEvent, ReviewMeta } from "../../src/review.js";

describe("ReviewEvent", () => {
  it("accepts each valid event", () => {
    for (const event of ["COMMENT", "APPROVE", "REQUEST_CHANGES"]) {
      expect(parse(ReviewEvent, event)).toBe(event);
    }
  });

  it("rejects an unknown event", () => {
    expect(() => parse(ReviewEvent, "MERGE")).toThrow();
  });
});

describe("ReviewMeta", () => {
  const base = {
    title: "Add the loader",
    body: "This PR adds the loader.",
    repoOwner: "acme",
    repoName: "widgets",
    number: 7,
    baseRef: "main",
    headRef: "feature",
    author: "octocat",
    url: "https://github.com/acme/widgets/pull/7",
  };

  it("accepts full PR metadata", () => {
    const value = parse(ReviewMeta, base);

    expect(value.number).toBe(7);
  });

  it("accepts null repo, number, and url for path mode", () => {
    const value = parse(ReviewMeta, {
      ...base,
      repoOwner: null,
      repoName: null,
      number: null,
      author: null,
      url: null,
    });

    expect(value.repoOwner).toBeNull();
  });

  it("rejects a missing baseRef", () => {
    const { baseRef: _omit, ...rest } = base;
    expect(() => parse(ReviewMeta, rest)).toThrow();
  });
});

describe("ReviewContext", () => {
  it("accepts a PR-mode context with viewer and repo", () => {
    const value = parse(ReviewContext, {
      sessionId: "s1",
      mode: "pr",
      viewer: { login: "octocat" },
      repo: { owner: "acme", name: "widgets" },
    });

    expect(value.viewer?.login).toBe("octocat");
  });

  it("accepts a path-mode context with null viewer and repo", () => {
    const value = parse(ReviewContext, {
      sessionId: "s2",
      mode: "path",
      viewer: null,
      repo: null,
    });

    expect(value.repo).toBeNull();
  });

  it("rejects an unknown mode", () => {
    expect(() =>
      parse(ReviewContext, { sessionId: "s3", mode: "branch", viewer: null, repo: null }),
    ).toThrow();
  });
});

describe("ReviewData", () => {
  const meta = {
    title: "t",
    body: "b",
    repoOwner: null,
    repoName: null,
    number: null,
    baseRef: "main",
    headRef: "feature",
    author: null,
    url: null,
  };

  it("accepts meta, diff, and comments", () => {
    const value = parse(ReviewData, {
      meta,
      diff: { rawDiff: "diff", files: [] },
      comments: [],
    });

    expect(value.comments).toHaveLength(0);
  });

  it("rejects a missing diff", () => {
    expect(() => parse(ReviewData, { meta, comments: [] })).toThrow();
  });
});
