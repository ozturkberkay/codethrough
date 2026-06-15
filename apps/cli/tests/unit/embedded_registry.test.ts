// Tests for the embedded-asset registry: the map the generated binary file
// installs, the lookup the server reads, and the binary check.
//
// These run under vitest, not a compiled binary, so the binary check is false and
// the lookup uses disk. The set/get round-trip is what the binary relies on.

import { afterEach, describe, expect, it } from "vitest";

import {
  embeddedAssetPath,
  isCompiledBinary,
  setEmbeddedManifest,
} from "../../src/server/embedded_registry.js";

// The registry is shared state; reset it after each test so order does not matter.
afterEach(() => {
  setEmbeddedManifest({});
});

describe("embeddedAssetPath", () => {
  it("returns undefined for any key before a manifest is installed", () => {
    expect(embeddedAssetPath("index.html")).toBeUndefined();
    expect(embeddedAssetPath("assets/app-ABC.js")).toBeUndefined();
  });

  it("returns the embedded path for a key in the installed manifest", () => {
    setEmbeddedManifest({
      "index.html": "/$bunfs/root/index-yy.html",
      "assets/app-ABC.js": "/$bunfs/root/app-ABC-xx.js",
    });
    expect(embeddedAssetPath("index.html")).toBe("/$bunfs/root/index-yy.html");
    expect(embeddedAssetPath("assets/app-ABC.js")).toBe("/$bunfs/root/app-ABC-xx.js");
  });

  it("returns undefined for a key not in the manifest", () => {
    setEmbeddedManifest({ "index.html": "/$bunfs/root/index-yy.html" });
    expect(embeddedAssetPath("assets/missing.js")).toBeUndefined();
  });

  it("a later install replaces the previous manifest", () => {
    setEmbeddedManifest({ "a.js": "/$bunfs/root/a.js" });
    setEmbeddedManifest({ "b.js": "/$bunfs/root/b.js" });
    expect(embeddedAssetPath("a.js")).toBeUndefined();
    expect(embeddedAssetPath("b.js")).toBe("/$bunfs/root/b.js");
  });
});

describe("isCompiledBinary", () => {
  it("is false under the test runner (no assets embedded)", () => {
    // Outside a compiled build there are no baked-in files, so this is false; the
    // binary flips it to true.
    expect(isCompiledBinary()).toBe(false);
  });
});
