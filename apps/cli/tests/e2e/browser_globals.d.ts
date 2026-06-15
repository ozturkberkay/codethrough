// The browser globals the e2e spec reads inside page.evaluate: the page config.
// Declared here so the spec type-checks without pulling in the frontend's version.

declare global {
  var __CODETHROUGH__: { token: string; apiBase: string } | undefined;
}

// An export so this file counts as a module (declare global needs one).
export type CliBrowserGlobals = typeof globalThis;
