// Checks at compile time that the real octokit client matches the small shape we
// inject. If a future octokit changes paginate or listReviewComments, this stops
// compiling, so we catch it before runtime.

import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import type { PaginatingOctokit } from "../../src/comment_fetch.js";

describe("PaginatingOctokit contract", () => {
  it("is satisfied by the real Octokit (assignability proven at type-check)", () => {
    const real = new Octokit({ auth: "token-for-construction-only" });
    // This assignment compiles only if the real client matches our shape.
    const narrow: PaginatingOctokit = real;

    expect(typeof narrow.paginate).toBe("function");
    expect(typeof narrow.rest.pulls.listReviewComments).toBe("function");
  });
});
