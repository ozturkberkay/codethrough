// The real I/O that needs a live network or filesystem: building the Anthropic
// client and reading the credential file or macOS keychain. Kept here so the
// logic that can be tested stays separate. This file is left out of coverage and
// exercised in real use.

import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";

import Anthropic from "@anthropic-ai/sdk";

import type { AnthropicCredential, CredentialDeps } from "./credential.js";

// The beta flag a Claude-subscription OAuth token needs. Set as a default header
// so it applies to every request.
const OAUTH_BETA_HEADER = "oauth-2025-04-20";

/**
 * Build the real Anthropic client from a credential: an API key uses key auth; an
 * oauth token uses bearer auth plus the oauth beta header.
 */
const clientFor = (credential: AnthropicCredential): Anthropic => {
  if (credential.kind === "apiKey") {
    return new Anthropic({ apiKey: credential.apiKey });
  }
  return new Anthropic({
    authToken: credential.token,
    defaultHeaders: { "anthropic-beta": OAUTH_BETA_HEADER },
  });
};

/** Read a UTF-8 file, or null when it is missing or unreadable. */
const readTextFile = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, "utf8") : null;

/**
 * The real inputs for the credential lookup: env, file, home, platform, clock, and
 * the macOS keychain command. Tests pass fakes for each instead.
 */
const defaultCredentialDeps: CredentialDeps = {
  getEnv: (name) => process.env[name],
  readTextFile,
  homeDir: homedir,
  platform,
  runCommand: (cmd, args) => {
    const result = Bun.spawnSync([cmd, ...args]);
    return { stdout: result.stdout.toString(), exitCode: result.exitCode };
  },
  now: () => Date.now(),
};

export { clientFor, defaultCredentialDeps };
