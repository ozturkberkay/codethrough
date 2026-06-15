// Tests for the gh token reuse strategies. The command runner, file reader, env,
// and platform are all fakes, so every strategy (gh CLI, macOS keychain,
// hosts.yml) runs on any OS.

import { describe, expect, it } from "vitest";

import type { CommandRunner, RunResult } from "../../src/command.js";
import { type TextFileReader, tryGhToken } from "../../src/gh_reuse.js";

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
const fail = (): RunResult => ({ code: 1, stdout: "", stderr: "" });
const enoent = (): RunResult => ({ code: -1, stdout: "", stderr: "ENOENT" });

const TOKEN = "gho_realtoken_ABC123";
const noFile: TextFileReader = () => null;
const onLinux = (): string => "linux";
const onMac = (): string => "darwin";

// A runner that returns a result for a given command name; any other command
// fails. Keeps the tests free of nested ternaries.
const byCmd =
  (table: Record<string, RunResult>): CommandRunner =>
  async (cmd) =>
    table[cmd] ?? fail();

describe("tryGhToken strategy A: gh auth token", () => {
  it("returns the gh-cli token when the binary prints a valid token", async () => {
    const run = byCmd({ gh: ok(`${TOKEN}\n`) });
    const result = await tryGhToken({ run, readTextFile: noFile, env: {}, platform: onLinux });
    expect(result).toEqual({ token: TOKEN, source: "gh-cli", detail: "`gh auth token`" });
  });

  it("skips gh-cli when the binary is absent (enoent) and falls through", async () => {
    const run: CommandRunner = async () => enoent();
    const result = await tryGhToken({ run, readTextFile: noFile, env: {}, platform: onLinux });
    expect(result.source).toBe("none");
    expect(result.token).toBeNull();
  });

  it("rejects gh-cli output that is not a GitHub token shape", async () => {
    const run = byCmd({ gh: ok("not-a-token") });
    const result = await tryGhToken({ run, readTextFile: noFile, env: {}, platform: onLinux });
    expect(result.source).toBe("none");
  });
});

describe("tryGhToken strategy B: macOS go-keyring", () => {
  const ghMissing = byCmd({});
  const hostsWithUser: TextFileReader = () => "github.com:\n    user: octocat\n";

  it("decodes a go-keyring-base64 blob into the token", async () => {
    const encoded = `go-keyring-base64:${Buffer.from(TOKEN, "utf8").toString("base64")}`;
    const run = byCmd({ security: ok(`${encoded}\n`) });
    const result = await tryGhToken({ run, readTextFile: hostsWithUser, env: {}, platform: onMac });
    expect(result).toEqual({
      token: TOKEN,
      source: "gh-keychain",
      detail: "keychain gh:github.com / octocat",
    });
  });

  it("accepts a raw (non-prefixed) keychain token", async () => {
    const run = byCmd({ security: ok(`${TOKEN}\n`) });
    const result = await tryGhToken({ run, readTextFile: hostsWithUser, env: {}, platform: onMac });
    expect(result.source).toBe("gh-keychain");
    expect(result.token).toBe(TOKEN);
  });

  it("is skipped on non-macOS platforms", async () => {
    const run = byCmd({ security: ok(TOKEN) });
    const result = await tryGhToken({
      run,
      readTextFile: hostsWithUser,
      env: {},
      platform: onLinux,
    });
    expect(result.source).toBe("none");
  });

  it("returns null when hosts.yml is absent (no username to look up)", async () => {
    const result = await tryGhToken({
      run: ghMissing,
      readTextFile: noFile,
      env: {},
      platform: onMac,
    });
    expect(result.source).toBe("none");
  });

  it("returns null when no active user is found in hosts.yml", async () => {
    const noUser: TextFileReader = () => "github.com:\n    git_protocol: ssh\n";
    const result = await tryGhToken({
      run: ghMissing,
      readTextFile: noUser,
      env: {},
      platform: onMac,
    });
    expect(result.source).toBe("none");
  });

  it("returns null when the keychain lookup fails", async () => {
    const result = await tryGhToken({
      run: ghMissing,
      readTextFile: hostsWithUser,
      env: {},
      platform: onMac,
    });
    expect(result.source).toBe("none");
  });

  it("rejects a keychain blob that is not a token shape", async () => {
    const run = byCmd({ security: ok("garbage-value") });
    const result = await tryGhToken({ run, readTextFile: hostsWithUser, env: {}, platform: onMac });
    expect(result.source).toBe("none");
  });
});

describe("tryGhToken strategy B: hosts.yml oauth_token", () => {
  const ghMissing = byCmd({});

  it("reads an inline oauth_token from hosts.yml on linux", async () => {
    const reader: TextFileReader = () => `github.com:\n    oauth_token: ${TOKEN}\n`;
    const result = await tryGhToken({
      run: ghMissing,
      readTextFile: reader,
      env: {},
      platform: onLinux,
    });
    expect(result).toEqual({
      token: TOKEN,
      source: "gh-hosts-file",
      detail: "hosts.yml oauth_token",
    });
  });

  it("returns none when hosts.yml has no oauth_token", async () => {
    const reader: TextFileReader = () => "github.com:\n    user: octocat\n";
    const result = await tryGhToken({
      run: ghMissing,
      readTextFile: reader,
      env: {},
      platform: onLinux,
    });
    expect(result.source).toBe("none");
  });

  it("rejects an oauth_token that is not a token shape", async () => {
    const reader: TextFileReader = () => "github.com:\n    oauth_token: nope\n";
    const result = await tryGhToken({
      run: ghMissing,
      readTextFile: reader,
      env: {},
      platform: onLinux,
    });
    expect(result.source).toBe("none");
  });

  it("honors GH_CONFIG_DIR when locating hosts.yml", async () => {
    const seen: string[] = [];
    const reader: TextFileReader = (path) => {
      seen.push(path);
      return `github.com:\n    oauth_token: ${TOKEN}\n`;
    };
    const result = await tryGhToken({
      run: ghMissing,
      readTextFile: reader,
      env: { GH_CONFIG_DIR: "/custom/gh/dir" },
      platform: onLinux,
    });
    expect(result.token).toBe(TOKEN);
    expect(seen.some((p) => p.startsWith("/custom/gh/dir"))).toBe(true);
  });
});

describe("tryGhToken default deps", () => {
  it("works with only an injected runner (real fs/env/platform defaults)", async () => {
    // A first-try gh hit never reads fs or env, so the defaults are used.
    const run = byCmd({ gh: ok(TOKEN) });
    const result = await tryGhToken({ run });
    expect(result.source).toBe("gh-cli");
  });
});
