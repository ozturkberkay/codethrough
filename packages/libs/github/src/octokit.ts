// A small wrapper around the GitHub REST client.
//
// Builds an octokit client from a token and exposes only the calls we need. The
// constructor is passed in so getViewer can be tested with a fake. We use the
// lighter REST-only package to keep the binary small.

import { resolveOctokitCtor } from "./runtime.js";

// The small slice of octokit we use. Typing by shape keeps the fake tiny while
// still matching the real client. Add to it as new calls are needed.
interface OctokitLike {
  rest: {
    users: {
      getAuthenticated: () => Promise<{ data: { login: string } }>;
    };
  };
}

type OctokitCtor = (token: string) => OctokitLike;

interface GitHubClientDeps {
  OctokitCtor?: OctokitCtor;
}

interface GitHubClient {
  octokit: OctokitLike;
  getViewer: () => Promise<{ login: string }>;
}

const createGitHubClient = (token: string, deps: GitHubClientDeps = {}): GitHubClient => {
  const ctor = resolveOctokitCtor(deps.OctokitCtor);
  const octokit = ctor(token);
  return {
    octokit,
    // Look up the user the token belongs to.
    getViewer: async () => {
      const { data } = await octokit.rest.users.getAuthenticated();
      return { login: data.login };
    },
  };
};

export { createGitHubClient };
export type { GitHubClient, GitHubClientDeps, OctokitCtor, OctokitLike };
