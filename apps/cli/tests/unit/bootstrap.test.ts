// Tests for the page-config reader: a valid global gives the config back, a
// missing or bad token throws a clear error, and the other fields are read
// leniently (path mode with comments off, or safe defaults when absent).

import { describe, expect, it } from "vitest";

import { type BootstrapHost, readBootstrap } from "../../frontend/bootstrap.js";

describe("readBootstrap", () => {
  it("reads a valid full bootstrap including mode + capabilities + context", () => {
    const host: BootstrapHost = {
      __CODETHROUGH__: {
        token: "t1",
        apiBase: "http://127.0.0.1:5",
        mode: "pr",
        capabilities: { comments: true },
        context: {
          sessionId: "s1",
          repo: { owner: "octo", name: "demo" },
          viewer: { login: "octocat" },
        },
      },
    };
    expect(readBootstrap(host)).toEqual({
      token: "t1",
      apiBase: "http://127.0.0.1:5",
      mode: "pr",
      capabilities: { comments: true },
      context: {
        sessionId: "s1",
        repo: { owner: "octo", name: "demo" },
        viewer: { login: "octocat" },
      },
    });
  });

  it("reads path mode with comments disabled (local-path run)", () => {
    const host: BootstrapHost = {
      __CODETHROUGH__: {
        token: "t1",
        mode: "path",
        capabilities: { comments: false },
        context: { sessionId: "s2", repo: null, viewer: null },
      },
    };
    const bootstrap = readBootstrap(host);
    expect(bootstrap.mode).toBe("path");
    expect(bootstrap.capabilities).toEqual({ comments: false });
    expect(bootstrap.context).toEqual({ sessionId: "s2", repo: null, viewer: null });
  });

  it("defaults apiBase + mode + capabilities + context safely when absent", () => {
    // With only a token, the result defaults to pr mode, comments off, and an
    // empty context.
    expect(readBootstrap({ __CODETHROUGH__: { token: "t1" } })).toEqual({
      token: "t1",
      apiBase: "",
      mode: "pr",
      capabilities: { comments: false },
      context: { sessionId: "", repo: null, viewer: null },
    });
    expect(readBootstrap({ __CODETHROUGH__: { token: "t1", apiBase: 5 } }).apiBase).toBe("");
  });

  it("defaults comments to false unless explicitly true", () => {
    expect(
      readBootstrap({ __CODETHROUGH__: { token: "t1", capabilities: { comments: "yes" } } })
        .capabilities,
    ).toEqual({ comments: false });
  });

  it("throws when the bootstrap is absent", () => {
    expect(() => readBootstrap({})).toThrow(/Missing bootstrap token/);
  });

  it("throws when the token is missing or empty", () => {
    expect(() => readBootstrap({ __CODETHROUGH__: {} })).toThrow(/Missing bootstrap token/);
    expect(() => readBootstrap({ __CODETHROUGH__: { token: "" } })).toThrow(
      /Missing bootstrap token/,
    );
    expect(() => readBootstrap({ __CODETHROUGH__: { token: 5 } })).toThrow(
      /Missing bootstrap token/,
    );
  });
});
