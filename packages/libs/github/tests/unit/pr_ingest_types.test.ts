// Checks at compile time that the real octokit client matches the small shape
// pr_ingest injects. If a future octokit changes pulls.get, this stops compiling,
// so we catch it before runtime.

import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import type { PrPullsClient } from "../../src/pr_ingest.js";

describe("PrPullsClient contract", () => {
  it("is satisfied by the real Octokit (assignability proven at type-check)", () => {
    const real = new Octokit({ auth: "token-for-construction-only" });
    // This assignment compiles only if the real client matches our shape.
    const narrow: PrPullsClient = real;

    expect(typeof narrow.rest.pulls.get).toBe("function");
  });
});
