// Put the run's token into the served page.
//
// SECURITY: we inject the token as a <script> on the page, not in the URL, so it
// cannot leak through browser history, the referrer header, or logs. Loading the
// page needs no token, which is safe: the Host check limits it to our address,
// only our own page can read the token, and the Origin check stops other sites
// from using it even if they got hold of the page.
//
// The injected value is JSON, escaped so it cannot break out of the script tag.

// The session info the frontend reads from the page. Sent in the page so the UI
// can render correctly before its first API call. No secret goes here.
interface BootstrapContext {
  sessionId: string;
  repo: { owner: string; name: string } | null;
  viewer: { login: string } | null;
}

// The config the frontend reads from the page. The token and API base drive the
// requests; mode and capabilities let the frontend show the right write UI in
// local-path mode without a failed request first. No secret goes here.
interface BootstrapConfig {
  token: string;
  apiBase: string;
  mode: "pr" | "path";
  capabilities: { comments: boolean };
  context: BootstrapContext;
}

// We insert the script just before this tag; if it is missing, we put the script
// at the top instead.
const HEAD_CLOSE = "</head>";

// Characters that are unsafe inside a <script>: `<` and `>` (so a stray
// `</script>` cannot close the tag early) and two separators that would end a JS
// string. Matched by code point so this file holds no invisible characters.
const UNSAFE_IN_SCRIPT = /[<>\u2028\u2029]/g;

// Width and base for a \uXXXX escape.
const HEX_WIDTH = 4;
const HEX_RADIX = 16;

// Turn one unsafe character into its \uXXXX escape, still valid JSON.
const toUnicodeEscape = (char: string): string => {
  const hex = char.codePointAt(0)!.toString(HEX_RADIX).padStart(HEX_WIDTH, "0").toUpperCase();
  return `${String.raw`\u`}${hex}`;
};

// Escape a JSON string so it is safe inside a <script>. It still parses back to
// the original.
const escapeForScript = (json: string): string =>
  json.replaceAll(UNSAFE_IN_SCRIPT, toUnicodeEscape);

// Build the inline <script> that carries the config.
const bootstrapScript = (config: BootstrapConfig): string =>
  `<script>globalThis.__CODETHROUGH__=${escapeForScript(JSON.stringify(config))};</script>`;

// Add the script to the page, just before the head closes, or at the top when
// there is no head. Everything else in the page is left alone.
const injectBootstrap = (html: string, config: BootstrapConfig): string => {
  const script = bootstrapScript(config);
  if (html.includes(HEAD_CLOSE)) {
    return html.replace(HEAD_CLOSE, `${script}${HEAD_CLOSE}`);
  }
  return `${script}${html}`;
};

export { bootstrapScript, escapeForScript, injectBootstrap };
export type { BootstrapConfig, BootstrapContext };
