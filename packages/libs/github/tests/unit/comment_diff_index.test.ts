// Tests for the placement index. The no-newline marker is the key case: a diff
// ending in "No newline at end of file" must not corrupt the index, since the
// marker's fake line number would clash with the real last line.

import { describe, expect, it } from "vitest";

import { buildCommentDiffIndex, findRow } from "../../src/comment_diff_index.js";

// Git's no-newline marker. String.raw keeps the backslash literal.
const PHANTOM = String.raw`\ No newline at end of file`;

const addDiff = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 const c = 3;
`;

describe("buildCommentDiffIndex", () => {
  it("indexes an added row on the RIGHT side by its new line", () => {
    const index = buildCommentDiffIndex(addDiff);
    const row = findRow(index, { path: "a.ts", line: 2, side: "RIGHT" });

    expect(row?.kind).toBe("add");
    expect(row?.content).toBe("+const b = 2;");
  });

  it("indexes a context row on BOTH sides (one physical line, two addresses)", () => {
    const index = buildCommentDiffIndex(addDiff);
    // The last context line is old line 2, new line 3.
    const viaRight = findRow(index, { path: "a.ts", line: 3, side: "RIGHT" });
    const viaLeft = findRow(index, { path: "a.ts", line: 2, side: "LEFT" });

    expect(viaRight).toBeDefined();
    expect(viaRight).toBe(viaLeft);
    expect(viaRight?.kind).toBe("context");
  });

  it("indexes a deleted row on the LEFT side by its old line", () => {
    const delDiff = `diff --git a/d.ts b/d.ts
index 1..2 100644
--- a/d.ts
+++ b/d.ts
@@ -1,3 +1,2 @@
 const a = 1;
-const gone = 2;
 const c = 3;
`;
    const index = buildCommentDiffIndex(delDiff);
    const row = findRow(index, { path: "d.ts", line: 2, side: "LEFT" });

    expect(row?.kind).toBe("del");
    expect(row?.content).toBe("-const gone = 2;");
  });

  it("uses the new path for renames (file.to unless /dev/null)", () => {
    const renameDiff = `diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
index 1..2 100644
--- a/old.ts
+++ b/new.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;
    const index = buildCommentDiffIndex(renameDiff);

    expect(index.rowsByPath.has("new.ts")).toBe(true);
    expect(index.rowsByPath.has("old.ts")).toBe(false);
    expect(findRow(index, { path: "new.ts", line: 2, side: "RIGHT" })?.kind).toBe("add");
  });

  it("uses the old path for deletes (file.to is /dev/null)", () => {
    const deleteFileDiff = `diff --git a/dead.ts b/dead.ts
deleted file mode 100644
index 1..0 000000
--- a/dead.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-const a = 1;
`;
    const index = buildCommentDiffIndex(deleteFileDiff);

    expect(index.rowsByPath.has("dead.ts")).toBe(true);
    expect(findRow(index, { path: "dead.ts", line: 1, side: "LEFT" })?.kind).toBe("del");
  });

  it("returns undefined for a line not in the diff", () => {
    const index = buildCommentDiffIndex(addDiff);

    expect(findRow(index, { path: "a.ts", line: 999, side: "RIGHT" })).toBeUndefined();
    expect(findRow(index, { path: "missing.ts", line: 1, side: "RIGHT" })).toBeUndefined();
  });

  it("skips the phantom no-newline marker so it cannot corrupt the index", () => {
    // The no-newline marker gets a fake line number that clashes with the real
    // last line. The real last added line (new line 2) must win.
    const noNewlineDiff = `diff --git a/n.ts b/n.ts
index 1..2 100644
--- a/n.ts
+++ b/n.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const last = 2;
${PHANTOM}
`;
    const index = buildCommentDiffIndex(noNewlineDiff);
    const rows = index.rowsByPath.get("n.ts") ?? [];

    // The marker row is dropped.
    expect(rows.some((r) => r.content === PHANTOM)).toBe(false);
    // The real last line is intact and can be looked up.
    const last = findRow(index, { path: "n.ts", line: 2, side: "RIGHT" });
    expect(last?.content).toBe("+const last = 2;");
  });

  it("skips a phantom marker on the deletion side too", () => {
    const noNewlineDelDiff = `diff --git a/n.ts b/n.ts
index 1..2 100644
--- a/n.ts
+++ b/n.ts
@@ -1,2 +1,1 @@
 const a = 1;
-const gone = 2;
${PHANTOM}
`;
    const index = buildCommentDiffIndex(noNewlineDelDiff);
    const rows = index.rowsByPath.get("n.ts") ?? [];

    expect(rows.some((r) => r.content === PHANTOM)).toBe(false);
    expect(findRow(index, { path: "n.ts", line: 2, side: "LEFT" })?.content).toBe(
      "-const gone = 2;",
    );
  });

  it("indexes nothing for empty input", () => {
    const index = buildCommentDiffIndex("");

    expect(index.rowsByPath.size).toBe(0);
  });

  it("skips a parsed file whose path cannot be determined", () => {
    // A bare hunk with no header has no path on either side, so it is dropped.
    const bareHunk = `@@ -1,1 +1,1 @@
-a
+b
`;
    const index = buildCommentDiffIndex(bareHunk);

    expect(index.rowsByPath.size).toBe(0);
  });
});
