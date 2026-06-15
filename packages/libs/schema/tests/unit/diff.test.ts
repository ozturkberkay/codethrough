import { parse } from "valibot";
import { describe, expect, it } from "vitest";
import { DiffFile, DiffModel, FileStatus } from "../../src/diff.js";

describe("FileStatus", () => {
  it("accepts each valid status", () => {
    for (const status of ["added", "modified", "renamed", "deleted"]) {
      expect(parse(FileStatus, status)).toBe(status);
    }
  });

  it("rejects an unknown status", () => {
    expect(() => parse(FileStatus, "moved")).toThrow();
  });
});

describe("DiffFile", () => {
  it("accepts a renamed file with an old path", () => {
    const value = parse(DiffFile, { path: "b.ts", oldPath: "a.ts", status: "renamed" });

    expect(value.oldPath).toBe("a.ts");
  });

  it("accepts a null old path", () => {
    const value = parse(DiffFile, { path: "a.ts", oldPath: null, status: "added" });

    expect(value.oldPath).toBeNull();
  });

  it("rejects a bad status", () => {
    expect(() => parse(DiffFile, { path: "a.ts", oldPath: null, status: "nope" })).toThrow();
  });
});

describe("DiffModel", () => {
  it("accepts a raw diff and its files", () => {
    const value = parse(DiffModel, {
      rawDiff: "diff --git a/a.ts b/a.ts",
      files: [{ path: "a.ts", oldPath: null, status: "modified" }],
    });

    expect(value.files).toHaveLength(1);
  });

  it("rejects a non-string raw diff", () => {
    expect(() => parse(DiffModel, { rawDiff: 1, files: [] })).toThrow();
  });
});
