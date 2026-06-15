// Read the config the server put in the page. It only reads the global and checks
// its shape, so the "missing config" path is tested by passing a stand-in. The
// real global is set by the script the server injects, so the token stays out of
// the URL.
//
// Besides the token and API base it carries the server's mode, capabilities, and
// context, so the frontend shows the right write UI without a failed request.

import type { Bootstrap } from "./http_data_source.js";

// The shape the reader looks at. Passed in so the reader does not read globalThis
// directly; main.tsx passes the real global. The value may be undefined until the
// server sets it. Only the token is required; the rest are read leniently.
interface BootstrapHost {
  __CODETHROUGH__?:
    | {
        token?: unknown;
        apiBase?: unknown;
        mode?: unknown;
        capabilities?: unknown;
        context?: unknown;
      }
    | undefined;
}

// The untyped record the readers narrow from.
type RawRecord = Record<string, unknown>;

// True for a non-null object, so reading its fields is safe.
const isRecord = (value: unknown): value is RawRecord =>
  typeof value === "object" && value !== null;

// Read the mode, defaulting to "pr" for anything that is not "path".
const readMode = (raw: unknown): "pr" | "path" => (raw === "path" ? "path" : "pr");

// Read the comments capability, defaulting to false unless it is exactly true, so
// a bad value never wrongly enables the write UI.
const readCapabilities = (raw: unknown): { comments: boolean } => ({
  comments: isRecord(raw) && raw["comments"] === true,
});

// Read an optional repo, or null when absent or malformed.
const readRepo = (raw: unknown): { owner: string; name: string } | null => {
  if (isRecord(raw) && typeof raw["owner"] === "string" && typeof raw["name"] === "string") {
    return { owner: raw["owner"], name: raw["name"] };
  }
  return null;
};

// Read an optional viewer, or null when absent or malformed.
const readViewer = (raw: unknown): { login: string } | null =>
  isRecord(raw) && typeof raw["login"] === "string" ? { login: raw["login"] } : null;

// Read the context (session, repo, viewer), with safe fallbacks.
const readContext = (raw: unknown): Bootstrap["context"] => {
  const record = isRecord(raw) ? raw : {};
  return {
    sessionId: typeof record["sessionId"] === "string" ? record["sessionId"] : "",
    repo: readRepo(record["repo"]),
    viewer: readViewer(record["viewer"]),
  };
};

// Read and return the config, or throw a clear error when it is missing (which
// only happens if the page was opened outside the server). The token is required;
// the rest are read leniently so a partial config still gives a usable source.
const readBootstrap = (host: BootstrapHost): Bootstrap => {
  const raw = host.__CODETHROUGH__;
  if (raw === undefined || typeof raw.token !== "string" || raw.token === "") {
    throw new Error("Missing bootstrap token; open this page via `codethrough run`.");
  }
  return {
    token: raw.token,
    apiBase: typeof raw.apiBase === "string" ? raw.apiBase : "",
    mode: readMode(raw.mode),
    capabilities: readCapabilities(raw.capabilities),
    context: readContext(raw.context),
  };
};

export { readBootstrap };
export type { BootstrapHost };
