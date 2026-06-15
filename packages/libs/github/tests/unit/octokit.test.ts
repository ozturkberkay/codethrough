// Tests for the octokit wrapper. The constructor is a fake, so getViewer runs
// with no network.

import { describe, expect, it, vi } from "vitest";

import { createGitHubClient, type OctokitLike } from "../../src/octokit.js";

const fakeOctokit = (login: string): OctokitLike => ({
  rest: {
    users: {
      getAuthenticated: async () => ({ data: { login } }),
    },
  },
});

describe("createGitHubClient", () => {
  it("passes the token to the injected constructor", () => {
    const ctor = vi.fn((_token: string) => fakeOctokit("octocat"));
    createGitHubClient("ghu_abc", { OctokitCtor: ctor });
    expect(ctor).toHaveBeenCalledWith("ghu_abc");
  });

  it("getViewer returns the authenticated user's login", async () => {
    const client = createGitHubClient("ghu_abc", { OctokitCtor: () => fakeOctokit("octocat") });
    expect(await client.getViewer()).toEqual({ login: "octocat" });
  });

  it("exposes the underlying octokit instance", () => {
    const octokit = fakeOctokit("octocat");
    const client = createGitHubClient("ghu_abc", { OctokitCtor: () => octokit });
    expect(client.octokit).toBe(octokit);
  });

  it("builds a real client when no deps are passed (construction only)", () => {
    // With no deps, it uses the real octokit constructor. Building it makes no
    // network call, and we never call getViewer here.
    const client = createGitHubClient("ghu_token_for_construction");
    expect(typeof client.getViewer).toBe("function");
    expect(client.octokit.rest.users.getAuthenticated).toBeTypeOf("function");
  });

  it("propagates an error from the authenticated-user call", async () => {
    const client = createGitHubClient("ghu_abc", {
      OctokitCtor: () => ({
        rest: {
          users: {
            getAuthenticated: async () => {
              throw new Error("401 Bad credentials");
            },
          },
        },
      }),
    });
    await expect(client.getViewer()).rejects.toThrow(/401/);
  });
});
