// Tests for parsePrUrl: the full URL form (with any trailing path or query), the
// owner/repo#number shorthand, and every case that should return null.

import { describe, expect, it } from "vitest";

import { parsePrUrl } from "../../src/pr_url.js";

describe("parsePrUrl: full URL", () => {
  it("parses a canonical pull URL", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/123")).toEqual({
      owner: "owner",
      repo: "repo",
      number: 123,
    });
  });

  it("parses an http (non-https) URL", () => {
    expect(parsePrUrl("http://github.com/o/r/pull/7")).toEqual({
      owner: "o",
      repo: "r",
      number: 7,
    });
  });

  it("tolerates a www. host", () => {
    expect(parsePrUrl("https://www.github.com/o/r/pull/7")?.number).toBe(7);
  });

  it("ignores a trailing path segment (e.g. /files)", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/123/files")).toEqual({
      owner: "owner",
      repo: "repo",
      number: 123,
    });
  });

  it("ignores a trailing query string", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/123?diff=split")?.number).toBe(123);
  });

  it("ignores a trailing fragment", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/123#discussion_r1")?.number).toBe(123);
  });

  it("is case-insensitive on the host", () => {
    expect(parsePrUrl("https://GitHub.com/o/r/pull/9")?.number).toBe(9);
  });

  it("trims surrounding whitespace", () => {
    expect(parsePrUrl("  https://github.com/o/r/pull/9  ")?.number).toBe(9);
  });

  it("keeps dots, hyphens and underscores in owner/repo", () => {
    expect(parsePrUrl("https://github.com/my-org/my_repo.js/pull/42")).toEqual({
      owner: "my-org",
      repo: "my_repo.js",
      number: 42,
    });
  });
});

describe("parsePrUrl: shorthand", () => {
  it("parses owner/repo#number", () => {
    expect(parsePrUrl("owner/repo#456")).toEqual({ owner: "owner", repo: "repo", number: 456 });
  });

  it("keeps special chars in the shorthand owner/repo", () => {
    expect(parsePrUrl("my-org/my_repo.js#1")).toEqual({
      owner: "my-org",
      repo: "my_repo.js",
      number: 1,
    });
  });

  it("trims surrounding whitespace on the shorthand", () => {
    expect(parsePrUrl("  o/r#5  ")?.number).toBe(5);
  });
});

describe("parsePrUrl: rejects", () => {
  it("rejects an empty string", () => {
    expect(parsePrUrl("")).toBeNull();
  });

  it("rejects a non-PR github URL (issues)", () => {
    expect(parsePrUrl("https://github.com/owner/repo/issues/123")).toBeNull();
  });

  it("rejects a repo URL with no pull segment", () => {
    expect(parsePrUrl("https://github.com/owner/repo")).toBeNull();
  });

  it("rejects a non-github host", () => {
    expect(parsePrUrl("https://gitlab.com/owner/repo/pull/123")).toBeNull();
  });

  it("rejects a look-alike host (github.com.evil.com)", () => {
    expect(parsePrUrl("https://github.com.evil.com/o/r/pull/1")).toBeNull();
  });

  it("rejects a non-numeric pull number in a URL", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/abc")).toBeNull();
  });

  it("rejects a missing owner in the URL", () => {
    expect(parsePrUrl("https://github.com//repo/pull/1")).toBeNull();
  });

  it("rejects shorthand without a number", () => {
    expect(parsePrUrl("owner/repo#")).toBeNull();
  });

  it("rejects shorthand with a non-numeric number", () => {
    expect(parsePrUrl("owner/repo#abc")).toBeNull();
  });

  it("rejects shorthand missing the repo", () => {
    expect(parsePrUrl("owner#1")).toBeNull();
  });

  it("rejects arbitrary text", () => {
    expect(parsePrUrl("just some words")).toBeNull();
  });
});
