// Reuse a real `gh auth token` through the real spawn. Skipped when gh is absent
// or not logged in, so CI skips it. The unit tests cover the logic; this is extra
// proof the real subprocess path works.

import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { tryGhToken } from "../../src/gh_reuse.js";

const ghAuthed = (): boolean => {
  const which = spawnSync("sh", ["-c", "command -v gh"]);
  if (which.status !== 0) {
    return false;
  }
  const tok = spawnSync("gh", ["auth", "token"]);
  return tok.status === 0 && tok.stdout.toString().trim().length > 0;
};

describe.skipIf(!ghAuthed())("gh-token reuse (REAL gh)", () => {
  it("reads a token that matches `gh auth token`", async () => {
    const result = await tryGhToken();
    expect(result.token).not.toBeNull();
    expect(result.source).not.toBe("none");

    const expected = spawnSync("gh", ["auth", "token"]).stdout.toString().trim();
    expect(result.token).toBe(expected);

    // Check it looks like a GitHub token, and never log the value.
    expect(result.token).toMatch(/^gh[opsu]_/);
  });
});
