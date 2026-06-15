// Unit tests for the `auth` subcommand parser and the top-level CLI dispatch.

import { describe, expect, it } from "vitest";

import { AuthArgsError, parseAuthArgs } from "../../src/args/auth_args.js";
import { parseCli } from "../../src/args/parse_cli.js";

describe("parseAuthArgs", () => {
  it("parses each subcommand", () => {
    expect(parseAuthArgs(["login"])).toBe("login");
    expect(parseAuthArgs(["logout"])).toBe("logout");
    expect(parseAuthArgs(["status"])).toBe("status");
  });

  it("rejects a missing subcommand", () => {
    expect(() => parseAuthArgs([])).toThrow(AuthArgsError);
    expect(() => parseAuthArgs([])).toThrow(/requires a subcommand/);
  });

  it("rejects an unknown subcommand", () => {
    expect(() => parseAuthArgs(["refresh"])).toThrow(/Unknown auth subcommand/);
  });

  it("rejects extra arguments", () => {
    expect(() => parseAuthArgs(["login", "extra"])).toThrow(/no extra arguments/);
  });
});

describe("parseCli", () => {
  it("returns help for no argv", () => {
    expect(parseCli([])).toEqual({ kind: "help" });
  });

  it("returns help for --help, -h, and help", () => {
    expect(parseCli(["--help"])).toEqual({ kind: "help" });
    expect(parseCli(["-h"])).toEqual({ kind: "help" });
    expect(parseCli(["help"])).toEqual({ kind: "help" });
  });

  it("returns help for an unknown command", () => {
    expect(parseCli(["frobnicate"])).toEqual({ kind: "help" });
  });

  it("dispatches run with its parsed args", () => {
    const result = parseCli(["run", "octo/demo#7", "--no-open"]);
    expect(result.kind).toBe("run");
    if (result.kind === "run") {
      expect(result.args.target).toEqual({
        kind: "pr",
        ref: { owner: "octo", repo: "demo", number: 7 },
        raw: "octo/demo#7",
      });
      expect(result.args.open).toBe(false);
    }
  });

  it("dispatches auth with its subcommand", () => {
    expect(parseCli(["auth", "status"])).toEqual({ kind: "auth", command: "status" });
  });
});
