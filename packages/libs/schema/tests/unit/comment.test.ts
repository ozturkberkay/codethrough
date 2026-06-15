import { parse } from "valibot";
import { describe, expect, it } from "vitest";
import { Comment, CommentDraft, Placement } from "../../src/comment.js";

const linePlacement = {
  kind: "line",
  strategy: "exact",
  side: "additions",
  lineNumber: 12,
  spanStartLine: null,
};

const generalPlacement = { kind: "general", strategy: "file-note" };

describe("Placement", () => {
  it("accepts a line placement", () => {
    const value = parse(Placement, linePlacement);

    expect(value.kind).toBe("line");
  });

  it("accepts a general placement", () => {
    const value = parse(Placement, generalPlacement);

    expect(value.kind).toBe("general");
  });

  it("accepts a multi-line span start on a line placement", () => {
    const value = parse(Placement, { ...linePlacement, spanStartLine: 8 });

    expect(value.kind === "line" && value.spanStartLine).toBe(8);
  });

  it("accepts an anchored-deletions line placement", () => {
    const value = parse(Placement, {
      ...linePlacement,
      strategy: "anchored-deletions",
      side: "deletions",
    });

    expect(value.kind === "line" && value.strategy).toBe("anchored-deletions");
  });

  it("accepts an anchored-additions line placement", () => {
    const value = parse(Placement, { ...linePlacement, strategy: "anchored-additions" });

    expect(value.kind === "line" && value.strategy).toBe("anchored-additions");
  });

  it("accepts an outdated-historical line placement", () => {
    const value = parse(Placement, { ...linePlacement, strategy: "outdated-historical" });

    expect(value.kind === "line" && value.strategy).toBe("outdated-historical");
  });

  it("rejects an unknown placement kind", () => {
    expect(() => parse(Placement, { kind: "block" })).toThrow();
  });

  it("rejects a line placement with a bad strategy", () => {
    expect(() => parse(Placement, { ...linePlacement, strategy: "guess" })).toThrow();
  });

  it("rejects a line placement with a bad side", () => {
    expect(() => parse(Placement, { ...linePlacement, side: "RIGHT" })).toThrow();
  });

  it("rejects a general placement with a bad strategy", () => {
    expect(() => parse(Placement, { kind: "general", strategy: "exact" })).toThrow();
  });
});

describe("Comment", () => {
  const base = {
    id: "c1",
    path: "a.ts",
    body: "Looks good.",
    author: "octocat",
    line: 12,
    originalLine: 10,
    side: "RIGHT",
    startLine: null,
    subjectType: "line",
    inReplyToId: null,
    placement: linePlacement,
  };

  it("accepts a well-formed line comment", () => {
    const value = parse(Comment, base);

    expect(value.side).toBe("RIGHT");
    expect(value.placement.kind).toBe("line");
  });

  it("accepts a file comment with a general placement", () => {
    const value = parse(Comment, {
      ...base,
      line: null,
      subjectType: "file",
      placement: generalPlacement,
    });

    expect(value.subjectType).toBe("file");
  });

  it("rejects a bad side", () => {
    expect(() => parse(Comment, { ...base, side: "additions" })).toThrow();
  });

  it("rejects a missing placement", () => {
    expect(() => parse(Comment, { ...base, placement: undefined })).toThrow();
  });
});

describe("CommentDraft", () => {
  const base = {
    path: "a.ts",
    body: "Consider renaming.",
    line: 12,
    side: "RIGHT",
    startLine: null,
    startSide: null,
    subjectType: "line",
  };

  it("accepts a single-line draft", () => {
    const value = parse(CommentDraft, base);

    expect(value.line).toBe(12);
  });

  it("accepts a multi-line draft with a start side", () => {
    const value = parse(CommentDraft, { ...base, startLine: 10, startSide: "RIGHT" });

    expect(value.startSide).toBe("RIGHT");
  });

  it("accepts a file draft with null line and side", () => {
    const value = parse(CommentDraft, {
      ...base,
      line: null,
      side: null,
      subjectType: "file",
    });

    expect(value.side).toBeNull();
  });

  it("rejects a bad subject type", () => {
    expect(() => parse(CommentDraft, { ...base, subjectType: "block" })).toThrow();
  });

  it("rejects an oversized body (a clean validation 400, not a transport failure)", () => {
    const tooLong = "x".repeat(65_537);
    expect(() => parse(CommentDraft, { ...base, body: tooLong })).toThrow();
  });

  it("rejects an oversized path", () => {
    const tooLong = `${"d/".repeat(2_049)}a.ts`;
    expect(() => parse(CommentDraft, { ...base, path: tooLong })).toThrow();
  });

  it("accepts a body at the maximum length", () => {
    const atMax = "x".repeat(65_536);
    expect(parse(CommentDraft, { ...base, body: atMax }).body).toHaveLength(65_536);
  });
});
