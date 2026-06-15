// Tests for the explore tools' argument checks: each tool checks the model's
// arguments before doing the work, throwing a ToolError on a bad shape. No I/O, no
// network.

import { describe, expect, it } from "vitest";

import { ToolError } from "../../src/explore_core.js";
import { parseGlobArgs, parseGrepArgs, parseReadArgs } from "../../src/explore_tools.js";

describe("parseReadArgs", () => {
  it("accepts a well-formed read_file arg with null line bounds", () => {
    expect(parseReadArgs({ path: "a.ts", startLine: null, endLine: null })).toEqual({
      path: "a.ts",
      startLine: null,
      endLine: null,
    });
  });

  it("accepts numeric line bounds", () => {
    expect(parseReadArgs({ path: "a.ts", startLine: 2, endLine: 10 })).toEqual({
      path: "a.ts",
      startLine: 2,
      endLine: 10,
    });
  });

  it("throws when args is not an object", () => {
    expect(() => parseReadArgs("nope")).toThrow(ToolError);
  });

  it("throws when path is missing or not a string", () => {
    expect(() => parseReadArgs({ startLine: null, endLine: null })).toThrow(/malformed/);
    expect(() => parseReadArgs({ path: 5, startLine: null, endLine: null })).toThrow(/malformed/);
  });

  it("throws when a line bound is neither a number nor null", () => {
    expect(() => parseReadArgs({ path: "a.ts", startLine: "1", endLine: null })).toThrow(
      /malformed/,
    );
    expect(() => parseReadArgs({ path: "a.ts", startLine: null, endLine: "x" })).toThrow(
      /malformed/,
    );
  });
});

describe("parseGrepArgs", () => {
  it("accepts a well-formed grep arg with a null path", () => {
    expect(parseGrepArgs({ pattern: "x", path: null })).toEqual({ pattern: "x", path: null });
  });

  it("accepts a string path", () => {
    expect(parseGrepArgs({ pattern: "x", path: "src" })).toEqual({ pattern: "x", path: "src" });
  });

  it("coerces a missing or non-string path to null", () => {
    expect(parseGrepArgs({ pattern: "x" })).toEqual({ pattern: "x", path: null });
    expect(parseGrepArgs({ pattern: "x", path: 7 })).toEqual({ pattern: "x", path: null });
  });

  it("throws when pattern is missing or not a string", () => {
    expect(() => parseGrepArgs({ path: null })).toThrow(/malformed/);
    expect(() => parseGrepArgs("nope")).toThrow(ToolError);
  });
});

describe("parseGlobArgs", () => {
  it("accepts a well-formed glob arg", () => {
    expect(parseGlobArgs({ pattern: "**/*.ts" })).toEqual({ pattern: "**/*.ts" });
  });

  it("throws when pattern is missing or not a string", () => {
    expect(() => parseGlobArgs({})).toThrow(/malformed/);
    expect(() => parseGlobArgs(null)).toThrow(ToolError);
  });
});
