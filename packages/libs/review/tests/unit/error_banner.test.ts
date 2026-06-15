// Tests that each kind of walkthrough failure maps to its own plain-English title.

import { describe, expect, it } from "vitest";

import { errorTitle } from "../../src/error_banner.js";

describe("errorTitle", () => {
  it("maps each error kind to a distinct title", () => {
    expect(errorTitle("refusal")).toMatch(/declined/i);
    expect(errorTitle("max_tokens")).toMatch(/cut off/i);
    expect(errorTitle("parse")).toMatch(/could not be parsed/i);
  });

  it("gives every kind a unique message", () => {
    const titles = [errorTitle("refusal"), errorTitle("max_tokens"), errorTitle("parse")];
    expect(new Set(titles).size).toBe(3);
  });
});
