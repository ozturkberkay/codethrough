// Builds the two things later phases need from the parsed diff: the hunk catalog
// the model reads (new-side lines under stable hunk ids) and the flat render rows
// (every added, removed, and unchanged line with its old and new numbers). The diff
// is parsed in one place, parse_diff.ts, shared with the changed-files summary.
//
// No I/O: it takes the diff text and returns plain data, so it is easy to test.

import type { Change, File } from "parse-diff";

import { classifyFile, parseFiles } from "./parse_diff.js";
import type { FileStatus, Hunk, HunkLine, RenderRow } from "./types.js";

interface HunkCatalog {
  hunks: Hunk[];
  rows: RenderRow[];
}

/** A trimmed catalog; `truncated` is true if a hunk was dropped or shortened. */
interface CappedCatalog extends HunkCatalog {
  truncated: boolean;
}

// Size limits for the catalog the model and renderer use. A huge PR (generated
// files, lockfiles) can have hunks totalling 100k+ lines, which would blow past the
// model's context and cost a lot to render. So we trim it: a cap per hunk, plus caps
// on total rows and total characters across kept hunks. The values come from config.
interface CatalogLimits {
  /** Most hunks to keep (drop the rest). */
  maxHunks: number;
  /** Most rows to keep in one hunk. */
  maxHunkRows: number;
  /** Most rows to keep across all hunks. */
  maxTotalRows: number;
  /** Most characters to keep across all hunks (a stand-in for prompt size). */
  maxTotalChars: number;
}

/**
 * The old and new line numbers for one change. We switch on the type because a plain
 * filter does not narrow the parse-diff union enough to read the fields directly.
 */
const lineNums = (ch: Change): { oldLine: number | null; newLine: number | null } => {
  switch (ch.type) {
    case "add": {
      return { oldLine: null, newLine: ch.ln };
    }
    case "del": {
      return { oldLine: ch.ln, newLine: null };
    }
    case "normal": {
      return { oldLine: ch.ln1, newLine: ch.ln2 };
    }
  }
};

/**
 * The status for a kept file. Deletions are filtered out before this runs, so the
 * classifier can only return added, renamed, or modified here, which is exactly
 * FileStatus, so the cast is safe.
 */
const fileStatus = (f: File): FileStatus => classifyFile(f) as FileStatus;

/**
 * Keep only files the walkthrough can show: skip deletions and files with no chunks
 * (binary files and renames with no edits parse to no chunks). A renamed file that
 * also changed keeps its chunks.
 */
const isWalkthroughFile = (f: File): boolean => !f.deleted && f.chunks.length > 0;

/** One hunk's id and the file and status it belongs to. */
interface HunkSpec {
  id: string;
  file: string;
  status: FileStatus;
}

/** Build one hunk (its catalog entry and its render rows) from a parsed chunk. */
const buildHunk = (spec: HunkSpec, changes: Change[]): { hunk: Hunk; rows: RenderRow[] } => {
  const { id, file, status } = spec;
  const lines: HunkLine[] = [];
  const rows: RenderRow[] = [];
  for (const ch of changes) {
    const { oldLine, newLine } = lineNums(ch);
    const content = ch.content.slice(1);
    rows.push({ hunkId: id, file, type: ch.type, oldLine, newLine, content });
    // The model reads only the new-side lines (added and unchanged).
    if (newLine !== null) {
      lines.push({ line: newLine, content });
    }
  }
  return { hunk: { id, file, status, lines }, rows };
};

/**
 * The files the walkthrough can show, each with a real new-side path. Deletions,
 * binaries, and no-edit renames are filtered out first so the build loop stays flat.
 */
interface KeptFile {
  file: string;
  status: FileStatus;
  chunks: File["chunks"];
}

const keptFiles = (files: File[]): KeptFile[] => {
  const kept: KeptFile[] = [];
  for (const f of files) {
    // The `!f.to` guard also narrows the optional path; only deletions lack a real
    // new-side path and those are already filtered out.
    if (isWalkthroughFile(f) && f.to) {
      kept.push({ file: f.to, status: fileStatus(f), chunks: f.chunks });
    }
  }
  return kept;
};

/**
 * Build the catalog from files that were already parsed. runEngine parses the diff
 * once and feeds the result to both this and the changed-files summary, so the diff
 * is not parsed twice.
 */
const buildHunkCatalogFromFiles = (files: File[]): HunkCatalog => {
  const hunks: Hunk[] = [];
  const rows: RenderRow[] = [];
  let nextId = 0;

  for (const { file, status, chunks } of keptFiles(files)) {
    for (const chunk of chunks) {
      const built = buildHunk({ id: `h${nextId++}`, file, status }, chunk.changes);
      hunks.push(built.hunk);
      rows.push(...built.rows);
    }
  }

  return { hunks, rows };
};

/** Parse the diff and return the hunk catalog plus the flat render rows. */
const buildHunkCatalog = (rawDiff: string): HunkCatalog =>
  buildHunkCatalogFromFiles(parseFiles(rawDiff));

/** Group every render row by the hunk id it belongs to, preserving order. */
const groupRowsByHunk = (rows: RenderRow[]): Map<string, RenderRow[]> => {
  const rowsByHunk = new Map<string, RenderRow[]>();
  for (const row of rows) {
    const group = rowsByHunk.get(row.hunkId);
    if (group) {
      group.push(row);
    } else {
      rowsByHunk.set(row.hunkId, [row]);
    }
  }
  return rowsByHunk;
};

/** Rebuild a hunk's new-side lines from the rows kept for it after capping. */
const newSideLines = (kept: RenderRow[]): HunkLine[] => {
  const lines: HunkLine[] = [];
  for (const row of kept) {
    if (row.newLine !== null) {
      lines.push({ line: row.newLine, content: row.content });
    }
  }
  return lines;
};

/**
 * Trim the catalog before the model phases so even a very large PR fits the model's
 * context and renders cheaply. We keep hunks in order, cutting each to the per-hunk
 * cap and stopping once the total row or character cap is hit, then rebuild each
 * kept hunk's new-side lines from its kept rows so the hunks and rows stay in sync.
 * `truncated` is true if anything was dropped or cut; compose then tells the model
 * the catalog is partial, and the renderer marks dropped hunks as not covered.
 */
const capCatalog = (catalog: HunkCatalog, limits: CatalogLimits): CappedCatalog => {
  const rowsByHunk = groupRowsByHunk(catalog.rows);

  const hunks: Hunk[] = [];
  const rows: RenderRow[] = [];
  let truncated = false;
  let usedRows = 0;
  let usedChars = 0;

  for (const hunk of catalog.hunks) {
    if (hunks.length >= limits.maxHunks) {
      truncated = true;
      break;
    }

    const hunkRows = rowsByHunk.get(hunk.id) ?? [];
    const kept: RenderRow[] = [];
    for (const row of hunkRows) {
      const budgetSpent =
        kept.length >= limits.maxHunkRows ||
        usedRows + kept.length >= limits.maxTotalRows ||
        usedChars >= limits.maxTotalChars;
      if (budgetSpent) {
        break;
      }
      kept.push(row);
      usedChars += row.content.length + 1;
    }

    if (kept.length === 0) {
      // No room left for this hunk; stop instead of adding an empty one.
      truncated = true;
      break;
    }
    if (kept.length < hunkRows.length) {
      truncated = true;
    }

    rows.push(...kept);
    usedRows += kept.length;
    hunks.push({ ...hunk, lines: newSideLines(kept) });
  }

  if (hunks.length < catalog.hunks.length) {
    truncated = true;
  }
  return { hunks, rows, truncated };
};

export { buildHunkCatalog, buildHunkCatalogFromFiles, capCatalog };
export type { CappedCatalog, CatalogLimits, HunkCatalog };
