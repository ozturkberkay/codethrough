// Tests for the static-asset helpers: the traversal guard keeps every path inside
// dist, "/" maps to index.html, content types are set for the worker and wasm
// files, and the resolver picks the baked-in file in the binary vs disk in dev.

import { describe, expect, it } from "vitest";

import {
  contentTypeFor,
  embeddedIndexPath,
  type EmbeddedLookup,
  resolveAssetPath,
  resolveServedAsset,
  toRelativeAssetKey,
} from "../../src/server/static_assets.js";

const DIST = "/app/dist";

// A fake lookup over a fixed map (the binary case).
const fakeLookup =
  (map: Record<string, string>): EmbeddedLookup =>
  (relPath) =>
    map[relPath];

// The empty lookup (dev: nothing is baked in).
const emptyLookup: EmbeddedLookup = fakeLookup({});

describe("resolveAssetPath", () => {
  it("maps / and empty to index.html", () => {
    expect(resolveAssetPath(DIST, "/")).toBe("/app/dist/index.html");
    expect(resolveAssetPath(DIST, "")).toBe("/app/dist/index.html");
  });

  it("resolves a normal asset path under dist", () => {
    expect(resolveAssetPath(DIST, "/assets/app.js")).toBe("/app/dist/assets/app.js");
  });

  it("strips leading ../ traversal so the path stays inside dist", () => {
    expect(resolveAssetPath(DIST, "/../../etc/passwd")).toBe("/app/dist/etc/passwd");
    expect(resolveAssetPath(DIST, "/../secret")).toBe("/app/dist/secret");
  });

  it("collapses a normalized traversal attempt", () => {
    // Normalizing resolves the .. before the strip; the result stays under dist.
    const resolved = resolveAssetPath(DIST, "/a/../../b");
    expect(resolved.startsWith(DIST)).toBe(true);
  });
});

describe("contentTypeFor", () => {
  it("returns explicit types for html/js/css/wasm", () => {
    expect(contentTypeFor("/x/index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("/x/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("/x/app.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("/x/shiki.wasm")).toBe("application/wasm");
  });

  it("returns null for an unknown extension (Bun infers it)", () => {
    expect(contentTypeFor("/x/logo.png")).toBeNull();
    expect(contentTypeFor("/x/data")).toBeNull();
  });
});

describe("toRelativeAssetKey", () => {
  it("maps / and empty to the index key (forward-slash, no leading slash)", () => {
    expect(toRelativeAssetKey("/")).toBe("index.html");
    expect(toRelativeAssetKey("")).toBe("index.html");
  });

  it("strips the leading slash so the key matches the manifest + join form", () => {
    expect(toRelativeAssetKey("/assets/app-ABC.js")).toBe("assets/app-ABC.js");
  });

  it("strips traversal so a key cannot escape the root", () => {
    expect(toRelativeAssetKey("/../../etc/passwd")).toBe("etc/passwd");
  });
});

describe("resolveServedAsset (dual-mode)", () => {
  it("dev mode resolves the on-disk path under dist (lookup ignored)", () => {
    const map = { "assets/app-ABC.js": "/$bunfs/root/app-ABC-xx.js" };
    // With compiled=false it is always disk, even if a manifest has the key.
    expect(
      resolveServedAsset(DIST, "/assets/app-ABC.js", { compiled: false, lookup: fakeLookup(map) }),
    ).toBe("/app/dist/assets/app-ABC.js");
  });

  it("dev mode maps / to the on-disk index.html", () => {
    expect(resolveServedAsset(DIST, "/", { compiled: false, lookup: emptyLookup })).toBe(
      "/app/dist/index.html",
    );
  });

  it("compiled mode returns the embedded blob path for a known asset", () => {
    const map = { "assets/app-ABC.js": "/$bunfs/root/app-ABC-xx.js" };
    expect(
      resolveServedAsset(DIST, "/assets/app-ABC.js", { compiled: true, lookup: fakeLookup(map) }),
    ).toBe("/$bunfs/root/app-ABC-xx.js");
  });

  it("compiled mode maps / to the embedded index blob", () => {
    const map = { "index.html": "/$bunfs/root/index-yy.html" };
    expect(resolveServedAsset(DIST, "/", { compiled: true, lookup: fakeLookup(map) })).toBe(
      "/$bunfs/root/index-yy.html",
    );
  });

  it("compiled mode returns null for an asset that is not embedded (SPA fallback)", () => {
    expect(
      resolveServedAsset(DIST, "/assets/missing.js", { compiled: true, lookup: emptyLookup }),
    ).toBeNull();
  });
});

describe("embeddedIndexPath", () => {
  it("returns the embedded index blob path when present", () => {
    const map = { "index.html": "/$bunfs/root/index-yy.html" };
    expect(embeddedIndexPath(fakeLookup(map))).toBe("/$bunfs/root/index-yy.html");
  });

  it("returns null when the index is not embedded", () => {
    expect(embeddedIndexPath(emptyLookup)).toBeNull();
  });
});
