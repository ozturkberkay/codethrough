import { describe, expect, it } from "vitest";
import type { Comment, Placement } from "@codethrough/schema";
import { groupComments } from "../../src/comment_groups.js";

const linePlace: Placement = {
  kind: "line",
  strategy: "exact",
  side: "additions",
  lineNumber: 2,
  spanStartLine: null,
};

const comment = (over: Partial<Comment> & { id: string }): Comment => ({
  path: "src/math.ts",
  body: "body",
  author: "octocat",
  line: 2,
  originalLine: 2,
  side: "RIGHT",
  startLine: null,
  subjectType: "line",
  inReplyToId: null,
  placement: linePlace,
  ...over,
});

const fileNote = (id: string, path: string): Comment =>
  comment({
    id,
    path,
    line: null,
    subjectType: "file",
    placement: { kind: "general", strategy: "file-note" },
  });

const outdated = (id: string, path: string): Comment =>
  comment({
    id,
    path,
    line: null,
    placement: { kind: "general", strategy: "outdated-unplaceable" },
  });

describe("groupComments", () => {
  it("splits line comments from general comments", () => {
    const result = groupComments([
      comment({ id: "line-1" }),
      fileNote("file-1", "src/math.ts"),
      outdated("gone-1", "src/old.ts"),
    ]);

    expect(result.lineComments.map((c) => c.id)).toEqual(["line-1"]);
    expect(result.generalByPath.get("src/math.ts")?.map((c) => c.id)).toEqual(["file-1"]);
    expect(result.generalByPath.get("src/old.ts")?.map((c) => c.id)).toEqual(["gone-1"]);
    expect(result.prGeneral).toEqual([]);
  });

  it("groups general comments per file path", () => {
    const result = groupComments([
      fileNote("a", "src/one.ts"),
      outdated("b", "src/one.ts"),
      fileNote("c", "src/two.ts"),
    ]);

    expect(result.generalByPath.get("src/one.ts")?.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.generalByPath.get("src/two.ts")?.map((c) => c.id)).toEqual(["c"]);
  });

  it("routes a path-less general comment to the PR-level bucket", () => {
    const result = groupComments([outdated("pr-level", "   "), fileNote("filed", "src/x.ts")]);

    expect(result.prGeneral.map((c) => c.id)).toEqual(["pr-level"]);
    expect(result.generalByPath.has("   ")).toBe(false);
  });

  it("groups replies under their parent id and keeps them out of the buckets", () => {
    const result = groupComments([
      comment({ id: "root" }),
      comment({ id: "reply-1", inReplyToId: "root", body: "first reply" }),
      comment({ id: "reply-2", inReplyToId: "root", body: "second reply" }),
    ]);

    expect(result.lineComments.map((c) => c.id)).toEqual(["root"]);
    expect(result.repliesByParentId.get("root")?.map((c) => c.id)).toEqual(["reply-1", "reply-2"]);
  });

  it("threads a reply even when the parent is a general comment", () => {
    const result = groupComments([
      fileNote("note-root", "src/x.ts"),
      comment({ id: "note-reply", inReplyToId: "note-root" }),
    ]);

    expect(result.generalByPath.get("src/x.ts")?.map((c) => c.id)).toEqual(["note-root"]);
    expect(result.repliesByParentId.get("note-root")?.map((c) => c.id)).toEqual(["note-reply"]);
  });

  it("handles the outdated-majority case: most comments land in the general area", () => {
    // Outdated comments often outnumber the line ones, so most of the
    // conversation would be hidden without the side area.
    const lineComments = [comment({ id: "live-1" }), comment({ id: "live-2" })];
    const outdatedComments = Array.from({ length: 8 }, (_unused, index) =>
      outdated(`old-${index}`, "src/legacy.ts"),
    );

    const result = groupComments([...lineComments, ...outdatedComments]);

    expect(result.lineComments).toHaveLength(2);
    expect(result.generalByPath.get("src/legacy.ts")).toHaveLength(8);
    const generalCount = [...result.generalByPath.values()].reduce(
      (sum, list) => sum + list.length,
      0,
    );
    expect(generalCount).toBeGreaterThan(result.lineComments.length);
  });

  it("returns empty buckets for no comments", () => {
    const result = groupComments([]);

    expect(result.lineComments).toEqual([]);
    expect(result.generalByPath.size).toBe(0);
    expect(result.prGeneral).toEqual([]);
    expect(result.repliesByParentId.size).toBe(0);
  });
});
