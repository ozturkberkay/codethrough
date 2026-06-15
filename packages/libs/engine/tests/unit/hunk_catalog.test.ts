import { describe, expect, it } from "vitest";

import { buildHunkCatalog } from "../../src/hunk_catalog.js";

// The fixtures match real `git diff` output: each hunk header's line counts match its
// content, which stops the parser from reading the next header as a normal line.

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
// The MODIFY/RENAME hunk headers use the exact 2-line counts git emits; a count
// that is too large makes the parser add an empty phantom line.

const PURE_RENAME = `diff --git a/a.ts b/b.ts
similarity index 100%
rename from a.ts
rename to b.ts
`;

const BINARY = `diff --git a/img.png b/img.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/img.png differ
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

const MULTI_HUNK = `diff --git a/big.ts b/big.ts
index ae57ad1..bdd04ad 100644
--- a/big.ts
+++ b/big.ts
@@ -1,4 +1,4 @@
-line1
+LINE1
 line2
 line3
 line4
@@ -12,4 +12,4 @@ line11
 line12
 line13
 line14
-line15
+LINE15
`;

describe("buildHunkCatalog row line numbers", () => {
  it("gives context rows both an old and a new line number", () => {
    const { rows } = buildHunkCatalog(MODIFY);
    const context = rows.find((r) => r.content === "context0")!;
    expect(context.type).toBe("normal");
    expect(context.oldLine).toBe(1);
    expect(context.newLine).toBe(1);
  });

  it("gives added rows only a new line number", () => {
    const { rows } = buildHunkCatalog(ADD);
    const added = rows.find((r) => r.content === "const a = 1;")!;
    expect(added.type).toBe("add");
    expect(added.oldLine).toBeNull();
    expect(added.newLine).toBe(1);
  });

  it("gives removed rows only an old line number", () => {
    const { rows } = buildHunkCatalog(MODIFY);
    const removed = rows.find((r) => r.content === "old line")!;
    expect(removed.type).toBe("del");
    expect(removed.oldLine).toBe(2);
    expect(removed.newLine).toBeNull();
  });

  it("strips the leading +/-/space prefix from content", () => {
    const { rows } = buildHunkCatalog(MODIFY);
    expect(rows.map((r) => r.content)).toEqual(["context0", "old line", "new line"]);
  });
});

describe("buildHunkCatalog render rows retain all rows", () => {
  it("keeps removed rows in the render rows (renderer shows both sides)", () => {
    const { rows } = buildHunkCatalog(MODIFY);
    expect(rows.some((r) => r.type === "del" && r.content === "old line")).toBe(true);
  });

  it("emits add/del/context rows in source order", () => {
    const { rows } = buildHunkCatalog(MODIFY);
    expect(rows.map((r) => r.type)).toEqual(["normal", "del", "add"]);
  });

  it("tags every row with its hunk id and new-side file path", () => {
    const { rows } = buildHunkCatalog(RENAME);
    expect(rows.every((r) => r.hunkId === "h0")).toBe(true);
    expect(rows.every((r) => r.file === "new_name.ts")).toBe(true);
  });
});

describe("buildHunkCatalog hunk catalog", () => {
  it("lists only new-side rows (added + context), never removed rows", () => {
    const { hunks } = buildHunkCatalog(MODIFY);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toEqual([
      { line: 1, content: "context0" },
      { line: 2, content: "new line" },
    ]);
  });

  it("assigns stable, sequential ids across hunks", () => {
    const { hunks } = buildHunkCatalog(MULTI_HUNK);
    expect(hunks.map((h) => h.id)).toEqual(["h0", "h1"]);
  });

  it("numbers hunk lines on the new side across multiple hunks", () => {
    const { hunks } = buildHunkCatalog(MULTI_HUNK);
    expect(hunks[1]!.lines).toEqual([
      { line: 12, content: "line12" },
      { line: 13, content: "line13" },
      { line: 14, content: "line14" },
      { line: 15, content: "LINE15" },
    ]);
  });

  it("increments hunk ids across separate kept files", () => {
    const { hunks } = buildHunkCatalog(ADD + MODIFY);
    expect(hunks.map((h) => h.id)).toEqual(["h0", "h1"]);
    expect(hunks.map((h) => h.file)).toEqual(["new.ts", "mod.ts"]);
  });

  it("tags each hunk's render rows with that hunk's id", () => {
    const { rows } = buildHunkCatalog(MULTI_HUNK);
    const idFor = (content: string) => rows.find((r) => r.content === content)!.hunkId;
    expect(idFor("line2")).toBe("h0");
    expect(idFor("line12")).toBe("h1");
  });
});

describe("buildHunkCatalog file status", () => {
  it("marks a new file as added", () => {
    const { hunks } = buildHunkCatalog(ADD);
    expect(hunks[0]!.status).toBe("added");
  });

  it("marks an in-place edit as modified", () => {
    const { hunks } = buildHunkCatalog(MODIFY);
    expect(hunks[0]!.status).toBe("modified");
  });

  it("marks a renamed-with-changes file as renamed", () => {
    const { hunks } = buildHunkCatalog(RENAME);
    expect(hunks[0]!.status).toBe("renamed");
  });
});

describe("buildHunkCatalog skip rules", () => {
  it("skips deleted files from both hunks and rows", () => {
    expect(buildHunkCatalog(DELETE)).toEqual({ hunks: [], rows: [] });
  });

  it("skips binary files from both hunks and rows", () => {
    expect(buildHunkCatalog(BINARY)).toEqual({ hunks: [], rows: [] });
  });

  it("skips pure renames (no content change) from both hunks and rows", () => {
    expect(buildHunkCatalog(PURE_RENAME)).toEqual({ hunks: [], rows: [] });
  });

  it("returns empty structures for an empty diff", () => {
    expect(buildHunkCatalog("")).toEqual({ hunks: [], rows: [] });
  });

  it("keeps changed files while skipping deleted ones in the same diff", () => {
    const { hunks } = buildHunkCatalog(DELETE + MODIFY);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.id).toBe("h0");
    expect(hunks[0]!.file).toBe("mod.ts");
  });
});
