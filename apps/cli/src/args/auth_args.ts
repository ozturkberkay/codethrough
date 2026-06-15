// Parse the `codethrough auth` subcommand. The caller passes the words after
// `auth`. Exactly one of login, logout, or status is required.
//
//   codethrough auth login | logout | status

// The three auth subcommands.
type AuthCommand = "login" | "logout" | "status";

const AUTH_COMMANDS = ["login", "logout", "status"] as const;

// A parse failure with a readable reason.
class AuthArgsError extends Error {}

// Parse the words after `auth` into the subcommand. A missing, unknown, or extra
// word is rejected.
const parseAuthArgs = (tokens: string[]): AuthCommand => {
  const [command, ...rest] = tokens;
  if (command === undefined) {
    throw new AuthArgsError(`auth requires a subcommand: ${AUTH_COMMANDS.join(" | ")}.`);
  }
  if (!(AUTH_COMMANDS as readonly string[]).includes(command)) {
    throw new AuthArgsError(`Unknown auth subcommand: ${command}.`);
  }
  if (rest.length > 0) {
    throw new AuthArgsError(`auth ${command} takes no extra arguments.`);
  }
  return command as AuthCommand;
};

export { AuthArgsError, parseAuthArgs };
export type { AuthCommand };
