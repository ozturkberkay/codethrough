// Drives the CLI's auth login, logout, and status commands.
//
// Collaborators (store, device-flow client, gh reuse, viewer lookup) are passed in
// so every branch can be tested with fakes. The token is saved as JSON under
// account "github.com".
//
// The user token is an OAuth-App token, so it does not expire: a stored token is
// either present and usable or absent. There is no refresh or expiry handling.

import { type DeviceFlowAuthenticator, type StoredToken, toStoredToken } from "./device_flow.js";
import type { GhReuseResult } from "./gh_reuse.js";
import type { SecretStore } from "./keychain.js";

// The account key the GitHub token is stored under.
const GITHUB_ACCOUNT = "github.com";

type TokenSource = "gh" | "stored" | "device";

interface ResolvedToken {
  token: string;
  source: TokenSource;
}

// Passed-in collaborators. tryGh and getViewer are functions so the CLI can wire
// the real ones and tests can pass fakes.
interface AuthDeps {
  store: SecretStore;
  client: DeviceFlowAuthenticator;
  tryGh: () => Promise<GhReuseResult>;
  // Look up the logged-in user for a token. Optional so status still works without it.
  getViewer?: (token: string) => Promise<{ login: string }>;
}

interface AuthStatus {
  authenticated: boolean;
  source?: TokenSource;
  login?: string;
}

// Read the saved token, or null if it is missing or corrupt. We swallow a bad
// value instead of throwing, so the caller just treats it as "no token".
const readStoredToken = async (store: SecretStore): Promise<StoredToken | null> => {
  const raw = await store.get(GITHUB_ACCOUNT);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
};

const persist = async (store: SecretStore, token: StoredToken): Promise<void> => {
  await store.set(GITHUB_ACCOUNT, JSON.stringify(token));
};

// Get a usable token. Try gh first, then the saved token; otherwise run the device
// flow and save what it returns.
const resolveToken = async (deps: AuthDeps): Promise<ResolvedToken> => {
  const gh = await deps.tryGh();
  if (gh.token !== null) {
    return { token: gh.token, source: "gh" };
  }

  const stored = await readStoredToken(deps.store);
  if (stored !== null) {
    return { token: stored.accessToken, source: "stored" };
  }

  const fresh = await deps.client.authenticate();
  const next = toStoredToken(fresh);
  await persist(deps.store, next);
  return { token: next.accessToken, source: "device" };
};

// Delete the stored token.
const logout = async (store: SecretStore): Promise<void> => {
  await store.delete(GITHUB_ACCOUNT);
};

// Look up the login if we can. A network or token error just returns nothing.
const resolveLogin = async (
  getViewer: ((token: string) => Promise<{ login: string }>) | undefined,
  token: string,
): Promise<string | undefined> => {
  if (!getViewer) {
    return undefined;
  }
  try {
    const viewer = await getViewer(token);
    return viewer.login;
  } catch {
    return undefined;
  }
};

// Report whether we have a usable token, without ever logging in. Adds the login
// when we can reach it. Only a gh token or a stored token counts.
const status = async (deps: AuthDeps): Promise<AuthStatus> => {
  const gh = await deps.tryGh();
  if (gh.token !== null) {
    const login = await resolveLogin(deps.getViewer, gh.token);
    return { authenticated: true, source: "gh", ...(login ? { login } : {}) };
  }

  const stored = await readStoredToken(deps.store);
  if (stored === null) {
    return { authenticated: false };
  }

  const login = await resolveLogin(deps.getViewer, stored.accessToken);
  return { authenticated: true, source: "stored", ...(login ? { login } : {}) };
};

export { GITHUB_ACCOUNT, logout, resolveToken, status };
export type { AuthDeps, AuthStatus, ResolvedToken, TokenSource };
