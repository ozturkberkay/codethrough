// Parse the diff once and build every view a run needs from it: the hunk catalog
// (trimmed to fit the model's context) and the changed-files summary for the explore
// prompt. runEngine uses this so the diff is not parsed twice; the standalone
// builders still parse on their own.

import { changedFilesFromFiles, type ChangedFile } from "./diff_summary.js";
import {
  buildHunkCatalogFromFiles,
  capCatalog,
  type CappedCatalog,
  type CatalogLimits,
  type HunkCatalog,
} from "./hunk_catalog.js";
import { parseFiles } from "./parse_diff.js";

/** The views a run builds from one parse: the trimmed catalog (plus the full one,
 * kept so the caller can log how much was dropped) and the changed files. */
interface DiffViews {
  full: HunkCatalog;
  catalog: CappedCatalog;
  changed: ChangedFile[];
}

/**
 * Parse the diff once and build the trimmed hunk catalog and the changed-files
 * summary. The full catalog is returned too so the caller can log how much the trim
 * dropped. `limits` bounds the catalog before the model phases.
 */
const deriveDiffViews = (rawDiff: string, limits: CatalogLimits): DiffViews => {
  const files = parseFiles(rawDiff);
  const full = buildHunkCatalogFromFiles(files);
  return {
    full,
    catalog: capCatalog(full, limits),
    changed: changedFilesFromFiles(files),
  };
};

export { deriveDiffViews };
export type { DiffViews };
