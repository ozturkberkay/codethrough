// Helpers for serving the built frontend: turn a request path into a file (on
// disk in dev, or baked into the binary), block path traversal, and pick a
// content type. Kept out of serve.ts so the traversal guard is easy to test.

import { join, normalize } from "node:path";

// The page served for "/" and any in-app route.
const INDEX_HTML = "index.html";

// Turn a request path into a key under the dist folder, blocking traversal: "/"
// (or empty) becomes index.html, and any leading slashes or "../" are stripped so
// the key cannot escape the folder.
const toRelativeAssetKey = (pathname: string): string => {
  // "" and "/" both collapse to the root here.
  const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const isRoot = clean === "/" || clean === "" || clean === ".";
  return isRoot ? INDEX_HTML : clean.replace(/^[/\\]+/, "");
};

// Turn a request path into a file under distDir, blocking traversal. The result
// is always inside distDir. Used in dev.
const resolveAssetPath = (distDir: string, pathname: string): string =>
  join(distDir, toRelativeAssetKey(pathname));

// Maps a request key to its file path inside the binary, or undefined when it is
// not baked in. Injected so the disk-vs-binary choice is easy to test.
type EmbeddedLookup = (relPath: string) => string | undefined;

// Tells the resolver whether this is the binary and how to find a baked-in file.
// One value because the flag and the lookup always go together.
interface EmbeddedSource {
  compiled: boolean;
  lookup: EmbeddedLookup;
}

// The file to read for a request: the baked-in path in the binary (or null for an
// unknown file, so the caller falls back to index.html), or the on-disk path in
// dev. Null in the binary avoids touching its read-only filesystem.
const resolveServedAsset = (
  distDir: string,
  pathname: string,
  source: EmbeddedSource,
): string | null => {
  const key = toRelativeAssetKey(pathname);
  if (source.compiled) {
    return source.lookup(key) ?? null;
  }
  return join(distDir, key);
};

// The baked-in path for index.html, or null when it is not baked in. Used to
// serve the page from the binary for an unknown route.
const embeddedIndexPath = (lookup: EmbeddedLookup): string | null => lookup(INDEX_HTML) ?? null;

// Content type for a file. Bun guesses most, but the worker and wasm files need an
// explicit one. Null when Bun's guess is fine.
const contentTypeFor = (path: string): string | null => {
  if (path.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (path.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (path.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (path.endsWith(".wasm")) {
    return "application/wasm";
  }
  return null;
};

export {
  contentTypeFor,
  embeddedIndexPath,
  INDEX_HTML,
  resolveAssetPath,
  resolveServedAsset,
  toRelativeAssetKey,
};
export type { EmbeddedLookup, EmbeddedSource };
