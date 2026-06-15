// Tests for the auth flow. The store, client, gh reuse, and viewer lookup are all
// fakes, so resolveToken's branches (gh, stored, device), logout, and status run
// with no network and no real keychain.

import { describe, expect, it, vi } from "vitest";

import {
  type DeviceFlowAuthenticator,
  type StoredToken,
  type TokenResponse,
  toStoredToken,
} from "../../src/device_flow.js";
import type { GhReuseResult } from "../../src/gh_reuse.js";
import type { SecretStore } from "../../src/keychain.js";
import { GITHUB_ACCOUNT, logout, resolveToken, status } from "../../src/auth.js";

// An in-memory secret store.
const memStore = (seed: Record<string, string> = {}): SecretStore & { db: Map<string, string> } => {
  const db = new Map<string, string>(Object.entries(seed));
  return {
    db,
    backend: "memory",
    set: async (account, secret) => {
      db.set(account, secret);
    },
    get: async (account) => db.get(account) ?? null,
    delete: async (account) => {
      db.delete(account);
    },
  };
};

const ghHit =
  (token: string): (() => Promise<GhReuseResult>) =>
  async () => ({ token, source: "gh-cli", detail: "x" });
const ghMiss: () => Promise<GhReuseResult> = async () => ({
  token: null,
  source: "none",
  detail: "none",
});

// A device-flow fake that records calls and returns the token it is told to.
interface FakeClient extends DeviceFlowAuthenticator {
  authCalls: number;
}
const fakeClient = (opts: { authenticate?: TokenResponse }): FakeClient => {
  const fake: FakeClient = {
    authCalls: 0,
    authenticate: async () => {
      fake.authCalls++;
      if (!opts.authenticate) {
        throw new Error("authenticate not scripted");
      }
      return opts.authenticate;
    },
  };
  return fake;
};

const DEVICE_TOKEN: TokenResponse = {
  access_token: "ghu_device_token",
  token_type: "bearer",
  scope: "repo",
};

describe("resolveToken", () => {
  it("branch gh: reuses a gh token without touching the store or client", async () => {
    const store = memStore();
    const out = await resolveToken({ store, client: fakeClient({}), tryGh: ghHit("gho_reused") });
    expect(out).toEqual({ token: "gho_reused", source: "gh" });
    // Nothing was saved; the gh path only reads.
    expect(store.db.size).toBe(0);
  });

  it("branch stored: uses a stored token", async () => {
    const stored: StoredToken = toStoredToken(DEVICE_TOKEN);
    const store = memStore({ [GITHUB_ACCOUNT]: JSON.stringify(stored) });
    const out = await resolveToken({ store, client: fakeClient({}), tryGh: ghMiss });
    expect(out).toEqual({ token: "ghu_device_token", source: "stored" });
  });

  it("branch device: runs the device flow when no token is stored, and persists it", async () => {
    const store = memStore();
    const client = fakeClient({ authenticate: DEVICE_TOKEN });
    const out = await resolveToken({ store, client, tryGh: ghMiss });
    expect(out).toEqual({ token: "ghu_device_token", source: "device" });
    expect(client.authCalls).toBe(1);
    const persisted = JSON.parse(store.db.get(GITHUB_ACCOUNT) as string) as StoredToken;
    expect(persisted).toEqual({ accessToken: "ghu_device_token" });
  });

  it("treats a corrupt stored record as absent and runs the device flow", async () => {
    // A non-JSON value must not throw; it is treated as no token, so we log in.
    const store = memStore({ [GITHUB_ACCOUNT]: "{ not valid json" });
    const out = await resolveToken({
      store,
      client: fakeClient({ authenticate: DEVICE_TOKEN }),
      tryGh: ghMiss,
    });
    expect(out.source).toBe("device");
  });
});

describe("logout", () => {
  it("deletes the stored token", async () => {
    const store = memStore({ [GITHUB_ACCOUNT]: "anything" });
    await logout(store);
    expect(store.db.has(GITHUB_ACCOUNT)).toBe(false);
  });
});

describe("status", () => {
  it("reports authenticated with a gh source and resolves the viewer login", async () => {
    const store = memStore();
    const getViewer = vi.fn(async (_t: string) => ({ login: "octocat" }));
    const out = await status({ store, client: fakeClient({}), tryGh: ghHit("gho_x"), getViewer });
    expect(out).toEqual({ authenticated: true, source: "gh", login: "octocat" });
    expect(getViewer).toHaveBeenCalledWith("gho_x");
  });

  it("omits the login when no viewer resolver is provided", async () => {
    const out = await status({ store: memStore(), client: fakeClient({}), tryGh: ghHit("gho_x") });
    expect(out).toEqual({ authenticated: true, source: "gh" });
  });

  it("swallows a viewer lookup failure and still reports authenticated", async () => {
    const getViewer = async (): Promise<{ login: string }> => {
      throw new Error("network down");
    };
    const out = await status({
      store: memStore(),
      client: fakeClient({}),
      tryGh: ghHit("gho_x"),
      getViewer,
    });
    expect(out).toEqual({ authenticated: true, source: "gh" });
  });

  it("reports not authenticated when no token is stored and gh misses", async () => {
    const out = await status({ store: memStore(), client: fakeClient({}), tryGh: ghMiss });
    expect(out).toEqual({ authenticated: false });
  });

  it("reports not authenticated when the stored record is corrupt", async () => {
    // A non-JSON value must be swallowed, not thrown, and read as no token.
    const store = memStore({ [GITHUB_ACCOUNT]: "<<corrupt>>" });
    const out = await status({ store, client: fakeClient({}), tryGh: ghMiss });
    expect(out).toEqual({ authenticated: false });
  });

  it("reports a stored token with its source and login", async () => {
    const stored = toStoredToken(DEVICE_TOKEN);
    const store = memStore({ [GITHUB_ACCOUNT]: JSON.stringify(stored) });
    const getViewer = async (): Promise<{ login: string }> => ({ login: "octocat" });
    const out = await status({ store, client: fakeClient({}), tryGh: ghMiss, getViewer });
    expect(out).toEqual({ authenticated: true, source: "stored", login: "octocat" });
  });

  it("reports a stored token without a login when no resolver is given", async () => {
    const stored = toStoredToken(DEVICE_TOKEN);
    const store = memStore({ [GITHUB_ACCOUNT]: JSON.stringify(stored) });
    const out = await status({ store, client: fakeClient({}), tryGh: ghMiss });
    expect(out).toEqual({ authenticated: true, source: "stored" });
  });
});
