// Runs `auth login | logout | status`. The three operations are injected so the
// command logic (which one to call, and what to print) is tested with fakes. The
// real ones live in the runtime shell.
//
// The token is NEVER printed: login and status report where it came from and the
// login, never the token.

import type { AuthStatus, ResolvedToken } from "@codethrough/github";

import type { AuthCommand } from "../args/auth_args.js";
import type { Logger } from "../logger.js";

// The three operations, injected. login gets a usable token (signing in if
// needed); status reports without signing in; logout clears the stored token.
interface AuthOps {
  login: () => Promise<ResolvedToken>;
  logout: () => Promise<void>;
  status: () => Promise<AuthStatus>;
}

// A readable label for where a token came from.
const SOURCE_LABEL: Record<ResolvedToken["source"], string> = {
  gh: "reused from the gh CLI",
  stored: "from the stored credential",
  device: "obtained via device flow",
};

// Run `auth login`: get a usable token and report where it came from (never the
// token). A failure (like the user denying the sign-in) goes up to the shell.
const runLogin = async (ops: AuthOps, logger: Logger): Promise<void> => {
  const resolved = await ops.login();
  logger.info(`Authenticated (${SOURCE_LABEL[resolved.source]}).`);
};

// Run `auth logout`: clear the stored token.
const runLogout = async (ops: AuthOps, logger: Logger): Promise<void> => {
  await ops.logout();
  logger.info("Logged out (cleared the stored credential).");
};

// Run `auth status`: report whether a token exists, where it came from, and the
// login when known. Never signs in.
const runStatus = async (ops: AuthOps, logger: Logger): Promise<void> => {
  const result = await ops.status();
  if (!result.authenticated) {
    logger.info("Not authenticated. Run `codethrough auth login`.");
    return;
  }
  const who = result.login ? ` as ${result.login}` : "";
  const via = result.source ? ` (${SOURCE_LABEL[result.source]})` : "";
  logger.info(`Authenticated${who}${via}.`);
};

// Dispatch the parsed auth subcommand to its handler.
const runAuth = (command: AuthCommand, ops: AuthOps, logger: Logger): Promise<void> => {
  if (command === "login") {
    return runLogin(ops, logger);
  }
  if (command === "logout") {
    return runLogout(ops, logger);
  }
  return runStatus(ops, logger);
};

export { runAuth };
export type { AuthOps };
