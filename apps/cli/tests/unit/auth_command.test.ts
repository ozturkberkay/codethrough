// Tests for the auth command: each subcommand calls the right operation and prints
// where the token came from, never the token.

import type { AuthStatus, ResolvedToken } from "@codethrough/github";
import { describe, expect, it } from "vitest";

import { type AuthOps, runAuth } from "../../src/commands/auth.js";
import { createLogger, type Logger } from "../../src/logger.js";

// A logger that captures stdout/stderr lines for assertions.
const captureLogger = (): { logger: Logger; out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  const logger = createLogger({
    out: { write: (chunk) => out.push(String(chunk)) },
    err: { write: (chunk) => err.push(String(chunk)) },
  });
  return { logger, out, err };
};

const TOKEN = "gho_secrettokenvalue";

describe("runAuth", () => {
  it("login resolves a token and reports its provenance, never the token", async () => {
    const resolved: ResolvedToken = { token: TOKEN, source: "device" };
    const ops: AuthOps = {
      login: async () => resolved,
      logout: async () => {},
      status: async () => ({ authenticated: false }),
    };
    const { logger, out } = captureLogger();
    await runAuth("login", ops, logger);
    expect(out.join("")).toContain("device flow");
    expect(out.join("")).not.toContain(TOKEN);
  });

  it("login reports the gh-reuse source", async () => {
    const ops: AuthOps = {
      login: async () => ({ token: TOKEN, source: "gh" }),
      logout: async () => {},
      status: async () => ({ authenticated: false }),
    };
    const { logger, out } = captureLogger();
    await runAuth("login", ops, logger);
    expect(out.join("")).toContain("gh CLI");
  });

  it("logout clears the credential", async () => {
    let cleared = false;
    const ops: AuthOps = {
      login: async () => ({ token: TOKEN, source: "device" }),
      logout: async () => {
        cleared = true;
      },
      status: async () => ({ authenticated: false }),
    };
    const { logger, out } = captureLogger();
    await runAuth("logout", ops, logger);
    expect(cleared).toBe(true);
    expect(out.join("")).toContain("Logged out");
  });

  it("status reports an authenticated viewer with provenance", async () => {
    const result: AuthStatus = { authenticated: true, source: "stored", login: "octocat" };
    const ops: AuthOps = {
      login: async () => ({ token: TOKEN, source: "device" }),
      logout: async () => {},
      status: async () => result,
    };
    const { logger, out } = captureLogger();
    await runAuth("status", ops, logger);
    const printed = out.join("");
    expect(printed).toContain("octocat");
    expect(printed).toContain("stored credential");
    expect(printed).not.toContain(TOKEN);
  });

  it("status reports not authenticated", async () => {
    const ops: AuthOps = {
      login: async () => ({ token: TOKEN, source: "device" }),
      logout: async () => {},
      status: async () => ({ authenticated: false }),
    };
    const { logger, out } = captureLogger();
    await runAuth("status", ops, logger);
    expect(out.join("")).toContain("Not authenticated");
  });

  it("status without a login still reports authenticated", async () => {
    const ops: AuthOps = {
      login: async () => ({ token: TOKEN, source: "device" }),
      logout: async () => {},
      status: async () => ({ authenticated: true, source: "gh" }),
    };
    const { logger, out } = captureLogger();
    await runAuth("status", ops, logger);
    expect(out.join("")).toContain("Authenticated");
  });
});
