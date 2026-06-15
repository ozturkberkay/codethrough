// Tests for the catalog trim. capCatalog keeps only the first N hunks and trims both
// hunks and rows to match, so the model can never point at a hunk the renderer
// dropped. `truncated` marks a partial catalog (it drives the compose note). No I/O.

import { describe, expect, it } from "vitest";

import { buildHunkCatalog, capCatalog, type HunkCatalog } from "../../src/hunk_catalog.js";

// The standard size limits. These tests only vary the hunk count, so the row and
// character limits stay fixed here.
const PER_HUNK_ROWS = 400;
const TOTAL_ROWS = 6_000;
const TOTAL_CHARS = 400_000;
const cap = (catalog: HunkCatalog, maxHunks: number): ReturnType<typeof capCatalog> =>
  capCatalog(catalog, {
    maxHunks,
    maxHunkRows: PER_HUNK_ROWS,
    maxTotalRows: TOTAL_ROWS,
    maxTotalChars: TOTAL_CHARS,
  });

// Three single-line added files -> three hunks (h0, h1, h2), each with one row.
const THREE_HUNKS = `diff --git a/a.ts b/a.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/a.ts
@@ -0,0 +1,1 @@
+const a = 1;
diff --git a/b.ts b/b.ts
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/b.ts
@@ -0,0 +1,1 @@
+const b = 2;
diff --git a/c.ts b/c.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/c.ts
@@ -0,0 +1,1 @@
+const c = 3;
`;

const catalog = buildHunkCatalog(THREE_HUNKS);

describe("capCatalog under or at the cap", () => {
  it("returns every hunk unchanged and truncated=false when under the cap", () => {
    const capped = cap(catalog, 60);
    expect(capped.hunks).toEqual(catalog.hunks);
    expect(capped.rows).toEqual(catalog.rows);
    expect(capped.truncated).toBe(false);
  });

  it("returns every hunk and truncated=false exactly at the cap", () => {
    const capped = cap(catalog, 3);
    expect(capped.hunks.map((h) => h.id)).toEqual(["h0", "h1", "h2"]);
    expect(capped.truncated).toBe(false);
  });
});

describe("capCatalog above the cap", () => {
  it("keeps only the first N hunks and sets truncated=true", () => {
    const capped = cap(catalog, 2);
    expect(capped.hunks.map((h) => h.id)).toEqual(["h0", "h1"]);
    expect(capped.truncated).toBe(true);
  });

  it("filters rows to exactly the kept hunk ids", () => {
    const capped = cap(catalog, 2);
    const rowIds = new Set(capped.rows.map((r) => r.hunkId));
    expect(rowIds).toEqual(new Set(["h0", "h1"]));
    // The dropped hunk's rows are gone too.
    expect(capped.rows.some((r) => r.hunkId === "h2")).toBe(false);
  });

  it("keeps the hunks and their rows consistent (same id set)", () => {
    const capped = cap(catalog, 1);
    const hunkIds = new Set(capped.hunks.map((h) => h.id));
    const rowIds = new Set(capped.rows.map((r) => r.hunkId));
    expect(hunkIds).toEqual(rowIds);
    expect(hunkIds).toEqual(new Set(["h0"]));
  });
});

describe("capCatalog edge cases", () => {
  it("is a no-op on an empty catalog (no hunks dropped)", () => {
    const empty = buildHunkCatalog("");
    const capped = cap(empty, 5);
    expect(capped.hunks).toEqual([]);
    expect(capped.rows).toEqual([]);
    expect(capped.truncated).toBe(false);
  });

  it("stops at a hunk that has no rows rather than emitting an empty one", () => {
    // A catalog whose first hunk has no matching rows: capCatalog finds nothing to
    // keep, marks it trimmed, and stops.
    const handBuilt: HunkCatalog = {
      hunks: [{ id: "h0", file: "a.ts", status: "modified", lines: [{ line: 1, content: "x" }] }],
      rows: [],
    };
    const capped = cap(handBuilt, 60);
    expect(capped.hunks).toEqual([]);
    expect(capped.rows).toEqual([]);
    expect(capped.truncated).toBe(true);
  });

  it("keeps del rows in the capped rows but not in the rebuilt new-side lines", () => {
    // A modify hunk has a removed row (no new-side line). capCatalog keeps every kept
    // row but rebuilds `lines` from new-side rows only, so the removed row is in
    // `rows` but not in `hunks[0].lines`.
    const modify = `diff --git a/mod.ts b/mod.ts
index 1111111..2222222 100644
--- a/mod.ts
+++ b/mod.ts
@@ -1,2 +1,2 @@
 context0
-old line
+new line
`;
    const capped = cap(buildHunkCatalog(modify), 60);
    expect(capped.rows.some((r) => r.type === "del" && r.content === "old line")).toBe(true);
    expect(capped.hunks[0]!.lines).toEqual([
      { line: 1, content: "context0" },
      { line: 2, content: "new line" },
    ]);
  });
});

/** A single-file diff that adds `n` lines (one hunk), each built by `fill`. */
const bigAddDiff = (
  file: string,
  n: number,
  fill: (i: number) => string = (i) => `line ${i + 1}`,
): string => {
  const header =
    `diff --git a/${file} b/${file}\n` +
    "new file mode 100644\n" +
    "index 0000000..1111111\n" +
    "--- /dev/null\n" +
    `+++ b/${file}\n` +
    `@@ -0,0 +1,${n} @@\n`;
  const body = Array.from({ length: n }, (_, i) => `+${fill(i)}`).join("\n");
  return `${header}${body}\n`;
};

describe("capCatalog content budget (large PRs)", () => {
  it("truncates a single oversized hunk to the per-hunk row cap", () => {
    // 400 is the per-hunk row cap; the rebuilt lines come from the kept rows.
    const capped = cap(buildHunkCatalog(bigAddDiff("big.ts", 1000)), 60);
    expect(capped.rows.length).toBe(400);
    expect(capped.hunks[0]!.lines.length).toBe(400);
    expect(capped.rows.every((r) => r.hunkId === "h0")).toBe(true);
    expect(capped.truncated).toBe(true);
  });

  it("stops at the total row budget across many hunks", () => {
    // 6000 is the total row limit, which is 15 hunks of 400 rows each.
    const big = Array.from({ length: 20 }, (_, i) => bigAddDiff(`f${i}.ts`, 1000)).join("");
    const capped = cap(buildHunkCatalog(big), 60);
    expect(capped.rows.length).toBe(6000);
    expect(capped.hunks.length).toBe(15);
    expect(capped.truncated).toBe(true);
  });

  it("stops at the total character budget when lines are huge", () => {
    const huge = "x".repeat(100_000);
    const capped = cap(buildHunkCatalog(bigAddDiff("min.js", 5, () => huge)), 60);
    // Four ~100k-char lines pass the 400k character limit before the fifth.
    expect(capped.rows.length).toBe(4);
    expect(capped.truncated).toBe(true);
  });
});
