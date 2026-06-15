// Tests for buildDiffModel: a raw diff in, a DiffModel out. Covers every file
// status, the rename oldPath, the no-newline marker, and empty input.

import { parse, safeParse } from "valibot";
import { describe, expect, it } from "vitest";

import { DiffModel } from "@codethrough/schema";

import { buildDiffModel } from "../../src/diff_model.js";

const PHANTOM = String.raw`\ No newline at end of file`;

const addedDiff = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..111
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+const a = 1;
+const b = 2;
`;

const modifiedDiff = `diff --git a/m.ts b/m.ts
index 111..222 100644
--- a/m.ts
+++ b/m.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 const c = 3;
`;

const renamedDiff = `diff --git a/old.ts b/new2.ts
similarity index 90%
rename from old.ts
rename to new2.ts
index 1..2 100644
--- a/old.ts
+++ b/new2.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;
`;

const pureRenameDiff = `diff --git a/oldp.ts b/newp.ts
similarity index 100%
rename from oldp.ts
rename to newp.ts
`;

const deletedDiff = `diff --git a/dead.ts b/dead.ts
deleted file mode 100644
index 1..0 000000
--- a/dead.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-const a = 1;
`;

describe("buildDiffModel", () => {
  it("preserves the raw diff verbatim", () => {
    expect(buildDiffModel(modifiedDiff).rawDiff).toBe(modifiedDiff);
  });

  it("produces output that satisfies the schema DiffModel", () => {
    const model = buildDiffModel(modifiedDiff);
    expect(safeParse(DiffModel, model).success).toBe(true);
    // This throws on a mismatch, so it is the strict check.
    expect(parse(DiffModel, model)).toEqual(model);
  });

  it("classifies an added file", () => {
    expect(buildDiffModel(addedDiff).files).toEqual([
      { path: "new.ts", oldPath: null, status: "added" },
    ]);
  });

  it("classifies a modified file", () => {
    expect(buildDiffModel(modifiedDiff).files).toEqual([
      { path: "m.ts", oldPath: null, status: "modified" },
    ]);
  });

  it("classifies a renamed file and carries the old path", () => {
    expect(buildDiffModel(renamedDiff).files).toEqual([
      { path: "new2.ts", oldPath: "old.ts", status: "renamed" },
    ]);
  });

  it("classifies a pure rename (no content change, zero hunks)", () => {
    expect(buildDiffModel(pureRenameDiff).files).toEqual([
      { path: "newp.ts", oldPath: "oldp.ts", status: "renamed" },
    ]);
  });

  it("classifies a deleted file by its old path", () => {
    expect(buildDiffModel(deletedDiff).files).toEqual([
      { path: "dead.ts", oldPath: null, status: "deleted" },
    ]);
  });

  it("handles a multi-file diff in order", () => {
    const model = buildDiffModel(`${addedDiff}${deletedDiff}${renamedDiff}`);
    expect(model.files).toEqual([
      { path: "new.ts", oldPath: null, status: "added" },
      { path: "dead.ts", oldPath: null, status: "deleted" },
      { path: "new2.ts", oldPath: "old.ts", status: "renamed" },
    ]);
  });

  it("is unaffected by a phantom no-newline marker", () => {
    const noNewline = `diff --git a/n.ts b/n.ts
index 1..2 100644
--- a/n.ts
+++ b/n.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const last = 2;
${PHANTOM}
`;
    expect(buildDiffModel(noNewline).files).toEqual([
      { path: "n.ts", oldPath: null, status: "modified" },
    ]);
  });

  it("returns no files for empty input", () => {
    expect(buildDiffModel("")).toEqual({ rawDiff: "", files: [] });
  });

  it("drops a parsed file with no usable path (a bare hunk)", () => {
    const bareHunk = `@@ -1,1 +1,1 @@
-a
+b
`;
    expect(buildDiffModel(bareHunk).files).toEqual([]);
  });
});
