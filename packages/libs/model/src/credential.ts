// Find the Anthropic credential from the environment, the Claude CLI's saved file,
// or (on macOS) its keychain item. All inputs are injected, so every source can be
// tested on any OS and no secret is sent anywhere here.
//
// Order, first hit wins:
//   1. ANTHROPIC_API_KEY            -> api key
//   2. CLAUDE_CODE_OAUTH_TOKEN      -> oauth
//   3. ANTHROPIC_AUTH_TOKEN         -> oauth
//   4. ~/.claude/.credentials.json  -> oauth (where Linux and Windows keep it)
//   5. macOS keychain               -> oauth
//   6. none -> null
//
// Sources 4 and 5 read the JSON the Claude CLI writes. An expired token is still
// returned so the run can try it, but flagged so we can suggest a refresh.

const API_KEY_ENV = "ANTHROPIC_API_KEY";
const OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
const AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";

// The macOS keychain name the Claude CLI stores its OAuth credentials under.
const KEYCHAIN_SERVICE = "Claude Code-credentials";
// The keychain command's exit code for "item not found"; treated as absent.
const KEYCHAIN_NOT_FOUND_EXIT = 44;

/**
 * An Anthropic credential: an API key, or an OAuth token for Claude-subscription
 * use. `expired` marks an OAuth token that is already past its expiry, so we can
 * suggest a refresh.
 */
type AnthropicCredential =
  | { kind: "apiKey"; apiKey: string }
  | { kind: "oauth"; token: string; expired?: boolean };

/** The result of running the keychain command. */
interface CredentialCommandResult {
  stdout: string;
  exitCode: number;
}

/** Inputs passed in so every source can be tested with no real I/O. */
interface CredentialDeps {
  /** Read an env var. */
  getEnv: (name: string) => string | undefined;
  /** Read a UTF-8 file, or null when it is missing or unreadable. */
  readTextFile: (path: string) => string | null;
  /** The current user's home directory. */
  homeDir: () => string;
  /** The OS name, used to decide whether to read the macOS keychain. */
  platform: () => string;
  /** Run the macOS keychain command. */
  runCommand: (cmd: string, args: string[]) => CredentialCommandResult;
  /** The current time in ms, for the expiry check. */
  now: () => number;
}

/** The parts of the Claude CLI credential file we read. */
interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken?: unknown;
    expiresAt?: unknown;
  };
}

/** A trimmed non-empty string, or undefined (so blank counts as unset). */
const nonEmpty = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

/**
 * Build an oauth credential from a token and optional expiry, flagging it expired
 * when that time has already passed. A missing or non-number expiry counts as not
 * expired, since the token may still work.
 */
const oauthFromToken = (
  deps: CredentialDeps,
  token: string,
  expiresAt: unknown,
): AnthropicCredential => {
  const expired = typeof expiresAt === "number" && expiresAt <= deps.now();
  return expired ? { kind: "oauth", token, expired: true } : { kind: "oauth", token };
};

/** Parse the credential JSON, or null when it is not valid JSON. */
const parseJson = (raw: string): ClaudeCredentialsFile | null => {
  try {
    return JSON.parse(raw) as ClaudeCredentialsFile;
  } catch {
    // A broken file counts as absent, so we fall through to the next source.
    return null;
  }
};

/** Read the oauth credential out of the credential JSON, or null. */
const credentialFromJson = (deps: CredentialDeps, raw: string): AnthropicCredential | null => {
  const parsed = parseJson(raw);
  const oauth = parsed?.claudeAiOauth;
  const token = nonEmpty(typeof oauth?.accessToken === "string" ? oauth.accessToken : undefined);
  if (token === undefined) {
    return null;
  }
  return oauthFromToken(deps, token, oauth?.expiresAt);
};

/** Sources 1 to 3: the three env vars in order, or null when none is set. */
const fromEnv = (deps: CredentialDeps): AnthropicCredential | null => {
  const apiKey = nonEmpty(deps.getEnv(API_KEY_ENV));
  if (apiKey !== undefined) {
    return { kind: "apiKey", apiKey };
  }
  const oauthToken =
    nonEmpty(deps.getEnv(OAUTH_TOKEN_ENV)) ?? nonEmpty(deps.getEnv(AUTH_TOKEN_ENV));
  if (oauthToken !== undefined) {
    return { kind: "oauth", token: oauthToken };
  }
  return null;
};

/** Source 4: the saved credential file in the user's home directory. */
const fromFile = (deps: CredentialDeps): AnthropicCredential | null => {
  // Forward slashes work on every OS, so we skip node:path to stay dependency-free.
  const raw = deps.readTextFile(`${deps.homeDir()}/.claude/.credentials.json`);
  return raw === null ? null : credentialFromJson(deps, raw);
};

/** Source 5: the macOS keychain item the Claude CLI writes. */
const fromKeychain = (deps: CredentialDeps): AnthropicCredential | null => {
  if (deps.platform() !== "darwin") {
    return null;
  }
  // Print just the stored value; the not-found exit code means absent.
  const result = deps.runCommand("security", [
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-w",
  ]);
  if (result.exitCode === KEYCHAIN_NOT_FOUND_EXIT || result.exitCode !== 0) {
    return null;
  }
  const raw = nonEmpty(result.stdout);
  return raw === undefined ? null : credentialFromJson(deps, raw);
};

/**
 * Find the Anthropic credential by trying each source in order, returning the
 * first hit or null. All I/O is passed in, so it can be tested with fakes.
 */
const resolveAnthropicCredential = (deps: CredentialDeps): AnthropicCredential | null =>
  fromEnv(deps) ?? fromFile(deps) ?? fromKeychain(deps);

export { resolveAnthropicCredential };
export type { AnthropicCredential, CredentialCommandResult, CredentialDeps };
