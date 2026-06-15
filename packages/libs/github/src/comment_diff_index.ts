// An index over a diff, used internally to place GitHub review comments on the
// right line. This is not the frontend's DiffModel; keep the two separate.

import parseDiff, { type Change, type File } from "parse-diff";

// The diff side. LEFT is the old file, RIGHT is the new file.
type DiffSide = "LEFT" | "RIGHT";

// One rendered diff line. The kind says which line numbers it has: an add has a
// new line, a del has an old line, a context line has both. This keeps later
// code free of null checks.
type RowKind = "add" | "del" | "context";

interface AddRow {
  path: string;
  kind: "add";
  newLine: number;
  content: string;
}

interface DelRow {
  path: string;
  kind: "del";
  oldLine: number;
  content: string;
}

interface ContextRow {
  path: string;
  kind: "context";
  newLine: number;
  oldLine: number;
  content: string;
}

type DiffRow = AddRow | DelRow | ContextRow;

interface CommentDiffIndex {
  // File path to its rows, in order.
  rowsByPath: Map<string, DiffRow[]>;
  // Look up a row by side and line, e.g. "path RIGHT 42".
  byRightLine: Map<string, DiffRow>;
  byLeftLine: Map<string, DiffRow>;
}

// A place to look up in the index: a path, line, and side.
interface RowAddress {
  path: string;
  line: number;
  side: DiffSide;
}

// One diff file with the single path GitHub keys comments by, so the build loop
// does not have to pick a path each time.
interface PathedFile {
  path: string;
  chunks: File["chunks"];
}

// Skip git's "no newline at end of file" marker. The parser gives it a fake line
// number that would clash with a real line.
const PHANTOM_NEWLINE_MARKER = String.raw`\ No newline at end of file`;

const DEV_NULL = "/dev/null";

const rowKey = (path: string, side: DiffSide, line: number): string => `${path} ${side} ${line}`;

// Pick each file's path: the new path normally, the old path for a deletion.
// Files with no usable path are dropped.
const pathedFiles = (rawDiff: string): PathedFile[] => {
  const files: PathedFile[] = [];
  for (const file of parseDiff(rawDiff)) {
    const path = file.to && file.to !== DEV_NULL ? file.to : (file.from ?? "");
    if (path) {
      files.push({ path, chunks: file.chunks });
    }
  }
  return files;
};

// Turn one parsed change into a row. We switch on the type to read the right
// line-number fields for an add, a delete, or a context line.
const rowForChange = (path: string, change: Change): DiffRow => {
  switch (change.type) {
    case "add": {
      return { path, kind: "add", newLine: change.ln, content: change.content };
    }
    case "del": {
      return { path, kind: "del", oldLine: change.ln, content: change.content };
    }
    case "normal": {
      return {
        path,
        kind: "context",
        newLine: change.ln2,
        oldLine: change.ln1,
        content: change.content,
      };
    }
  }
};

// Add a row to the lookups for each side it can be found on. A context line goes
// on both sides; an add or delete goes on one.
const registerRow = (index: CommentDiffIndex, row: DiffRow): void => {
  if (row.kind !== "del") {
    index.byRightLine.set(rowKey(row.path, "RIGHT", row.newLine), row);
  }
  if (row.kind !== "add") {
    index.byLeftLine.set(rowKey(row.path, "LEFT", row.oldLine), row);
  }
};

// Build the index from a raw diff.
const buildCommentDiffIndex = (rawDiff: string): CommentDiffIndex => {
  const index: CommentDiffIndex = {
    rowsByPath: new Map<string, DiffRow[]>(),
    byRightLine: new Map<string, DiffRow>(),
    byLeftLine: new Map<string, DiffRow>(),
  };

  for (const { path, chunks } of pathedFiles(rawDiff)) {
    const rows = index.rowsByPath.get(path) ?? [];
    // Drop the no-newline marker first. Its fake line number would otherwise
    // overwrite the real last line in the lookups.
    const changes = chunks
      .flatMap((chunk) => chunk.changes)
      .filter((change) => change.content !== PHANTOM_NEWLINE_MARKER);
    for (const change of changes) {
      const row = rowForChange(path, change);
      registerRow(index, row);
      rows.push(row);
    }
    index.rowsByPath.set(path, rows);
  }

  return index;
};

// Look up the row at an address, or undefined if the diff has no such line.
const findRow = (index: CommentDiffIndex, address: RowAddress): DiffRow | undefined => {
  const { path, line, side } = address;
  const map = side === "RIGHT" ? index.byRightLine : index.byLeftLine;
  return map.get(rowKey(path, side, line));
};

export { buildCommentDiffIndex, findRow };
export type { CommentDiffIndex, DiffRow, DiffSide, RowAddress, RowKind };
