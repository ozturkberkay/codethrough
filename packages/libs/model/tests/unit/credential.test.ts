// Tests for which credential source wins, with env, file, keychain, platform, and
// clock all passed in. Every source (api key, the two oauth env tokens, the saved
// file including expired, the macOS keychain, and none) runs the same on any OS
// with no real I/O.

import { describe, expect, it } from "vitest";

import {
  type AnthropicCredential,
  type CredentialCommandResult,
  type CredentialDeps,
  resolveAnthropicCredential,
} from "../../src/credential.js";

// A fixed "now" so the expiry check is stable.
const NOW = 1_000_000;

// Look up an env var in a map (a missing key reads as undefined).
const envFrom =
  (map: Record<string, string | undefined>): ((name: string) => string | undefined) =>
  (name) =>
    map[name];

// Build deps with empty defaults; each test overrides only what it needs.
const makeDeps = (over: Partial<CredentialDeps> = {}): CredentialDeps => ({
  getEnv: envFrom({}),
  readTextFile: () => null,
  homeDir: () => "/home/u",
  platform: () => "linux",
  runCommand: (): CredentialCommandResult => ({ stdout: "", exitCode: 1 }),
  now: () => NOW,
  ...over,
});

// Build the credential JSON the file and keychain sources parse.
const credentialsJson = (accessToken: string, expiresAt?: number): string =>
  JSON.stringify({
    claudeAiOauth: { accessToken, ...(expiresAt === undefined ? {} : { expiresAt }) },
  });

describe("resolveAnthropicCredential: env sources", () => {
  it("returns an apiKey credential from ANTHROPIC_API_KEY (highest precedence)", () => {
    const deps = makeDeps({
      getEnv: envFrom({
        ANTHROPIC_API_KEY: "sk-ant-api-123",
        CLAUDE_CODE_OAUTH_TOKEN: "oauth-should-be-ignored",
      }),
    });
    expect(resolveAnthropicCredential(deps)).toEqual({ kind: "apiKey", apiKey: "sk-ant-api-123" });
  });

  it("returns an oauth credential from CLAUDE_CODE_OAUTH_TOKEN", () => {
    const deps = makeDeps({ getEnv: envFrom({ CLAUDE_CODE_OAUTH_TOKEN: "oauth-abc" }) });
    expect(resolveAnthropicCredential(deps)).toEqual({ kind: "oauth", token: "oauth-abc" });
  });

  it("falls back to ANTHROPIC_AUTH_TOKEN when CLAUDE_CODE_OAUTH_TOKEN is unset", () => {
    const deps = makeDeps({ getEnv: envFrom({ ANTHROPIC_AUTH_TOKEN: "auth-xyz" }) });
    expect(resolveAnthropicCredential(deps)).toEqual({ kind: "oauth", token: "auth-xyz" });
  });

  it("prefers CLAUDE_CODE_OAUTH_TOKEN over ANTHROPIC_AUTH_TOKEN", () => {
    const deps = makeDeps({
      getEnv: envFrom({ CLAUDE_CODE_OAUTH_TOKEN: "first", ANTHROPIC_AUTH_TOKEN: "second" }),
    });
    expect(resolveAnthropicCredential(deps)).toEqual({ kind: "oauth", token: "first" });
  });

  it("treats a blank env value as unset and falls through to the next source", () => {
    const deps = makeDeps({
      getEnv: envFrom({ ANTHROPIC_API_KEY: "   ", CLAUDE_CODE_OAUTH_TOKEN: "oauth-real" }),
    });
    expect(resolveAnthropicCredential(deps)).toEqual({ kind: "oauth", token: "oauth-real" });
  });

  it("trims surrounding whitespace from a resolved value", () => {
    const deps = makeDeps({ getEnv: envFrom({ ANTHROPIC_API_KEY: "  sk-ant-pad  " }) });
    expect(resolveAnthropicCredential(deps)).toEqual({ kind: "apiKey", apiKey: "sk-ant-pad" });
  });
});

describe("resolveAnthropicCredential: credentials.json file source", () => {
  it("reads ~/.claude/.credentials.json and returns the oauth access token", () => {
    let readPath = "";
    const deps = makeDeps({
      homeDir: () => "/home/alice",
      readTextFile: (path) => {
        readPath = path;
        return credentialsJson("sk-ant-oat01-file", NOW + 10_000);
      },
    });
    expect(resolveAnthropicCredential(deps)).toEqual({ kind: "oauth", token: "sk-ant-oat01-file" });
    expect(readPath).toBe("/home/alice/.claude/.credentials.json");
  });

  it("flags a clearly-expired token as expired (so the caller can advise a refresh)", () => {
    const deps = makeDeps({
      readTextFile: () => credentialsJson("sk-ant-oat01-stale", NOW - 1),
    });
    const result = resolveAnthropicCredential(deps);
    expect(result).toEqual({ kind: "oauth", token: "sk-ant-oat01-stale", expired: true });
  });

  it("does not flag a token whose expiry is still in the future", () => {
    const deps = makeDeps({ readTextFile: () => credentialsJson("sk-ant-oat01-fresh", NOW + 1) });
    const result = resolveAnthropicCredential(deps) as AnthropicCredential & { kind: "oauth" };
    expect(result.expired).toBeUndefined();
  });

  it("treats a token with no expiry field as not expired", () => {
    const deps = makeDeps({ readTextFile: () => credentialsJson("sk-ant-oat01-noexp") });
    expect(resolveAnthropicCredential(deps)).toEqual({
      kind: "oauth",
      token: "sk-ant-oat01-noexp",
    });
  });

  it("returns null for a malformed credentials file (treated as absent)", () => {
    const deps = makeDeps({ readTextFile: () => "{ not valid json" });
    expect(resolveAnthropicCredential(deps)).toBeNull();
  });

  it("returns null when the file lacks a claudeAiOauth access token", () => {
    const deps = makeDeps({ readTextFile: () => JSON.stringify({ claudeAiOauth: {} }) });
    expect(resolveAnthropicCredential(deps)).toBeNull();
  });

  it("ignores a non-number expiresAt and returns the token unflagged", () => {
    const deps = makeDeps({
      readTextFile: () =>
        JSON.stringify({ claudeAiOauth: { accessToken: "tok", expiresAt: "soon" } }),
    });
    expect(resolveAnthropicCredential(deps)).toEqual({ kind: "oauth", token: "tok" });
  });
});

describe("resolveAnthropicCredential: macOS keychain source", () => {
  it("reads the keychain item on darwin and returns the oauth token", () => {
    let ranArgs: string[] = [];
    const deps = makeDeps({
      platform: () => "darwin",
      runCommand: (cmd, args) => {
        ranArgs = [cmd, ...args];
        return { stdout: `${credentialsJson("sk-ant-oat01-keychain")}\n`, exitCode: 0 };
      },
    });
    expect(resolveAnthropicCredential(deps)).toEqual({
      kind: "oauth",
      token: "sk-ant-oat01-keychain",
    });
    expect(ranArgs).toEqual([
      "security",
      "find-generic-password",
      "-s",
      "Claude Code-credentials",
      "-w",
    ]);
  });

  it("does not touch the keychain on a non-darwin platform", () => {
    let called = false;
    const deps = makeDeps({
      platform: () => "linux",
      runCommand: () => {
        called = true;
        return { stdout: "", exitCode: 0 };
      },
    });
    expect(resolveAnthropicCredential(deps)).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null when the keychain item is not found (exit 44)", () => {
    const deps = makeDeps({
      platform: () => "darwin",
      runCommand: () => ({ stdout: "", exitCode: 44 }),
    });
    expect(resolveAnthropicCredential(deps)).toBeNull();
  });

  it("returns null when the keychain command fails with a non-zero code", () => {
    const deps = makeDeps({
      platform: () => "darwin",
      runCommand: () => ({ stdout: "", exitCode: 1 }),
    });
    expect(resolveAnthropicCredential(deps)).toBeNull();
  });

  it("returns null when the keychain returns empty stdout on success", () => {
    const deps = makeDeps({
      platform: () => "darwin",
      runCommand: () => ({ stdout: "   \n", exitCode: 0 }),
    });
    expect(resolveAnthropicCredential(deps)).toBeNull();
  });
});

describe("resolveAnthropicCredential: precedence + none", () => {
  it("prefers the env over the file over the keychain", () => {
    const deps = makeDeps({
      getEnv: envFrom({ ANTHROPIC_API_KEY: "env-key" }),
      readTextFile: () => credentialsJson("file-token"),
      platform: () => "darwin",
      runCommand: () => ({ stdout: credentialsJson("keychain-token"), exitCode: 0 }),
    });
    expect(resolveAnthropicCredential(deps)).toEqual({ kind: "apiKey", apiKey: "env-key" });
  });

  it("prefers the file over the keychain when no env is set", () => {
    const deps = makeDeps({
      readTextFile: () => credentialsJson("file-token"),
      platform: () => "darwin",
      runCommand: () => ({ stdout: credentialsJson("keychain-token"), exitCode: 0 }),
    });
    expect(resolveAnthropicCredential(deps)).toEqual({ kind: "oauth", token: "file-token" });
  });

  it("returns null when no source yields a credential", () => {
    expect(resolveAnthropicCredential(makeDeps())).toBeNull();
  });
});
