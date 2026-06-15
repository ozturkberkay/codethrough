// Tests for the `run` arg parser: every flag, PR-url vs local-path detection, the
// defaults, and the validation errors.

import { describe, expect, it } from "vitest";

import { parseRunArgs, RunArgsError } from "../../src/args/run_args.js";

describe("parseRunArgs", () => {
  it("defaults to working-tree path mode with browser open and no overrides", () => {
    const args = parseRunArgs([]);
    expect(args.target).toEqual({ kind: "path", path: ".", raw: "." });
    expect(args.open).toBe(true);
    expect(args.base).toBeUndefined();
    expect(args.head).toBeUndefined();
    expect(args.model).toBeUndefined();
    expect(args.effort).toBeUndefined();
    expect(args.port).toBeUndefined();
  });

  it("detects a PR URL positional and parses its ref", () => {
    const args = parseRunArgs(["https://github.com/octo/demo/pull/7"]);
    expect(args.target).toEqual({
      kind: "pr",
      ref: { owner: "octo", repo: "demo", number: 7 },
      raw: "https://github.com/octo/demo/pull/7",
    });
  });

  it("detects the owner/repo#number shorthand as a PR ref", () => {
    const args = parseRunArgs(["octo/demo#42"]);
    expect(args.target).toEqual({
      kind: "pr",
      ref: { owner: "octo", repo: "demo", number: 42 },
      raw: "octo/demo#42",
    });
  });

  it("treats a non-URL positional as a local path", () => {
    const args = parseRunArgs(["../some/repo"]);
    expect(args.target).toEqual({ kind: "path", path: "../some/repo", raw: "../some/repo" });
  });

  it("parses every value flag", () => {
    const args = parseRunArgs([
      ".",
      "--base",
      "main",
      "--head",
      "feature",
      "--repo",
      "/work/repo",
      "--model",
      "claude-x",
      "--effort",
      "max",
      "--port",
      "8080",
    ]);
    expect(args.base).toBe("main");
    expect(args.head).toBe("feature");
    expect(args.repo).toBe("/work/repo");
    expect(args.model).toBe("claude-x");
    expect(args.effort).toBe("max");
    expect(args.port).toBe(8_080);
  });

  it("parses --no-open before or after the positional", () => {
    expect(parseRunArgs(["--no-open", "."]).open).toBe(false);
    expect(parseRunArgs([".", "--no-open"]).open).toBe(false);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseRunArgs(["--bogus"]).target).toThrow(RunArgsError);
    expect(() => parseRunArgs(["--bogus"]).target).toThrow(/Unknown flag/);
  });

  it("rejects a second positional", () => {
    expect(() => parseRunArgs([".", "extra"]).target).toThrow(/extra argument/);
  });

  it("rejects a value flag with no value", () => {
    expect(() => parseRunArgs(["--model"]).target).toThrow(/requires a value/);
  });

  it("rejects an invalid effort", () => {
    expect(() => parseRunArgs(["--effort", "medium"]).target).toThrow(/--effort must be one of/);
  });

  it("rejects a non-numeric port", () => {
    expect(() => parseRunArgs(["--port", "abc"]).target).toThrow(/positive integer/);
  });

  it("rejects a port out of the TCP range", () => {
    expect(() => parseRunArgs(["--port", "0"]).target).toThrow(/between/);
    expect(() => parseRunArgs(["--port", "70000"]).target).toThrow(/between/);
  });

  it("accepts the highest legal port", () => {
    expect(parseRunArgs(["--port", "65535"]).port).toBe(65_535);
  });
});
