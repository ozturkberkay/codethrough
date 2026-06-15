// The list of frontend files baked into the compiled binary.
//
// Two modes:
//   - dev: nothing fills this in, so it stays empty and the server reads the
//     frontend from the dist folder on disk.
//   - binary: a generated file (built by scripts/build.ts) bakes in every dist
//     file and fills this map in before the server starts, so the server reads
//     them from inside the binary.
//
// We keep our own map instead of using Bun's file list because Bun renames each
// baked-in file (it adds a hash), so the original request path would no longer
// match. The map keeps the original path as the key. The build regenerates it
// every time, so a new file is never missed.

// Maps a request path (like "assets/index-D6VKOpRu.js") to the file's path inside
// the binary, which Bun reads from.
type EmbeddedManifest = Readonly<Record<string, string>>;

// Empty in dev; filled in by the generated binary file.
let manifest: EmbeddedManifest = {};

// Install the map. Called once by the generated binary file before the server
// starts; never called in dev.
const setEmbeddedManifest = (next: EmbeddedManifest): void => {
  manifest = next;
};

// True when this is the compiled binary. Bun only lists baked-in files in a
// compiled build, so a non-empty list is the reliable signal.
const isCompiledBinary = (): boolean => Bun.embeddedFiles.length > 0;

// The baked-in path for a request path, or undefined when it is not baked in (an
// unknown path, or dev). The caller falls back to disk.
const embeddedAssetPath = (relPath: string): string | undefined => manifest[relPath];

export { embeddedAssetPath, isCompiledBinary, setEmbeddedManifest };
export type { EmbeddedManifest };
