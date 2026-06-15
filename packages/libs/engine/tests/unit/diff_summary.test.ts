// Tests for the changed-files list. The change type and the add/remove counts come
// straight from the parsed diff. No I/O: takes the diff, returns plain data.

import { describe, expect, it } from "vitest";

import { changedFiles } from "../../src/diff_summary.js";

const ADD = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+const a = 1;
+const b = 2;
`;

const MODIFY = `diff --git a/mod.ts b/mod.ts
index 1111111..2222222 100644
--- a/mod.ts
+++ b/mod.ts
@@ -1,2 +1,2 @@
 context0
-old line
+new line
`;

const RENAME = `diff --git a/old_name.ts b/new_name.ts
similarity index 80%
rename from old_name.ts
rename to new_name.ts
index 3333333..4444444 100644
--- a/old_name.ts
+++ b/new_name.ts
@@ -1,2 +1,2 @@
 keep
-was here
+now here
`;

const DELETE = `diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 5555555..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two
`;

describe("changedFiles change type", () => {
  it("marks a new file ADDED with its addition count", () => {
    expect(changedFiles(ADD)).toEqual([
      { path: "new.ts", additions: 2, deletions: 0, changeType: "ADDED" },
    ]);
  });

  it("marks an in-place edit MODIFIED counting both add and del", () => {
    expect(changedFiles(MODIFY)).toEqual([
      { path: "mod.ts", additions: 1, deletions: 1, changeType: "MODIFIED" },
    ]);
  });

  it("marks a renamed-with-changes file RENAMED on the new-side path", () => {
    expect(changedFiles(RENAME)).toEqual([
      { path: "new_name.ts", additions: 1, deletions: 1, changeType: "RENAMED" },
    ]);
  });

  it("marks a deleted file DELETED on the old-side path", () => {
    // A deletion has no new-side path, so the old-side path names the removed file;
    // its removed lines are counted.
    expect(changedFiles(DELETE)).toEqual([
      { path: "gone.ts", additions: 0, deletions: 2, changeType: "DELETED" },
    ]);
  });
});

describe("changedFiles multiple files", () => {
  it("lists each changed file in diff order", () => {
    const files = changedFiles(ADD + MODIFY);
    expect(files.map((f) => f.path)).toEqual(["new.ts", "mod.ts"]);
  });

  it("returns an empty list for an empty diff", () => {
    expect(changedFiles("")).toEqual([]);
  });

  it("skips a malformed entry that has no usable path", () => {
    // A bare hunk with no `diff --git` header has no path on either side, so it is
    // skipped.
    const bareHunk = `@@ -1,1 +1,1 @@
-a
+b
`;
    expect(changedFiles(bareHunk)).toEqual([]);
  });
});
