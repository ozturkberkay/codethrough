// Checks at compile time that the real octokit client matches the small shape
// review_submit injects. If a future octokit changes pulls.createReview, this
// stops compiling, so we catch it before runtime.

import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import type { ReviewPullsClient } from "../../src/review_submit.js";

describe("ReviewPullsClient contract", () => {
  it("is satisfied by the real Octokit (assignability proven at type-check)", () => {
    const real = new Octokit({ auth: "token-for-construction-only" });
    // This assignment compiles only if the real client matches our shape.
    const narrow: ReviewPullsClient = real;

    expect(typeof narrow.rest.pulls.createReview).toBe("function");
  });
});
