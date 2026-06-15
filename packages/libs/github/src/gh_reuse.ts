// Reuse the gh CLI's token so the user does not have to log in again.
//
// We try, in order:
//   A. Run `gh auth token`, which prints the active token. Preferred, since gh
//      reads its own storage for us.
//   B. Read gh's storage directly, for when the gh binary is gone but its login
//      remains. On macOS the token is in the keychain; on Linux/Windows it may
//      sit in gh's hosts.yml.
//
// The command runner, file reader, env, and platform are all passed in, so every
// path can be tested on any OS.

import { homedir, platform } from "node:os";
import { join } from "node:path";

import type { CommandRunner } from "./command.js";
import { resolveReadTextFile, spawnRunner } from "./runtime.js";

const TOKEN_RE = /^gh[opsu]_[A-Za-z0-9_]+$/;
const GO_KEYRING_PREFIX = "go-keyring-base64:";

interface GhReuseResult {
  token: string | null;
  source: "gh-cli" | "gh-keychain" | "gh-hosts-file" | "none";
  detail: string;
}

// Reads a text file, or null if it is missing.
type TextFileReader = (path: string) => string | null;

interface GhReuseDeps {
  run?: CommandRunner;
  readTextFile?: TextFileReader;
  env?: Record<string, string | undefined>;
  platform?: () => string;
}

interface ResolvedGhReuseDeps {
  run: CommandRunner;
  readTextFile: TextFileReader;
  env: Record<string, string | undefined>;
  platform: () => string;
}

const resolveDeps = (deps: GhReuseDeps): ResolvedGhReuseDeps => ({
  run: deps.run ?? spawnRunner,
  readTextFile: resolveReadTextFile(deps.readTextFile),
  env: deps.env ?? process.env,
  platform: deps.platform ?? platform,
});

const hostsPath = (env: Record<string, string | undefined>): string =>
  join(env["GH_CONFIG_DIR"] ?? join(homedir(), ".config", "gh"), "hosts.yml");

// Strategy A: ask gh for the token.
const viaGhCli = async (deps: ResolvedGhReuseDeps): Promise<GhReuseResult | null> => {
  const r = await deps.run("gh", ["auth", "token"]);
  if (r.code !== 0) {
    return null;
  }
  const token = r.stdout.trim();
  if (!TOKEN_RE.test(token)) {
    return null;
  }
  return { token, source: "gh-cli", detail: "`gh auth token`" };
};

// Read the gh username out of hosts.yml without pulling in a YAML library.
const ghUsername = (deps: ResolvedGhReuseDeps): string | null => {
  const text = deps.readTextFile(hostsPath(deps.env));
  if (text === null) {
    return null;
  }
  const m = text.match(/^\s*user:\s*(\S+)\s*$/m);
  return m === null ? null : (m[1] as string);
};

// Strategy B (macOS): read gh's token straight from the keychain.
const viaMacKeychain = async (deps: ResolvedGhReuseDeps): Promise<GhReuseResult | null> => {
  if (deps.platform() !== "darwin") {
    return null;
  }
  const user = ghUsername(deps);
  if (!user) {
    return null;
  }
  const r = await deps.run("security", [
    "find-generic-password",
    "-s",
    "gh:github.com",
    "-a",
    user,
    "-w",
  ]);
  if (r.code !== 0) {
    return null;
  }
  let raw = r.stdout.replace(/\n$/, "");
  // The value is base64-encoded behind a prefix; decode it.
  if (raw.startsWith(GO_KEYRING_PREFIX)) {
    raw = Buffer.from(raw.slice(GO_KEYRING_PREFIX.length), "base64").toString("utf8");
  }
  if (!TOKEN_RE.test(raw)) {
    return null;
  }
  return { token: raw, source: "gh-keychain", detail: `keychain gh:github.com / ${user}` };
};

// Strategy B (Linux/Windows): the token may be written inside hosts.yml.
const viaHostsFile = (deps: ResolvedGhReuseDeps): GhReuseResult | null => {
  const text = deps.readTextFile(hostsPath(deps.env));
  if (text === null) {
    return null;
  }
  const m = text.match(/oauth_token:\s*(\S+)/);
  const token = m?.[1];
  if (token === undefined || !TOKEN_RE.test(token)) {
    return null;
  }
  return { token, source: "gh-hosts-file", detail: "hosts.yml oauth_token" };
};

// Try each strategy in turn and return the token and where it came from.
const tryGhToken = async (deps: GhReuseDeps = {}): Promise<GhReuseResult> => {
  const resolved = resolveDeps(deps);
  return (
    (await viaGhCli(resolved)) ??
    (await viaMacKeychain(resolved)) ??
    viaHostsFile(resolved) ?? { token: null, source: "none", detail: "no gh token found" }
  );
};

export { tryGhToken };
export type { GhReuseDeps, GhReuseResult, TextFileReader };
