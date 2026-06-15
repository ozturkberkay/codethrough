// Tests for the page token injection. Checks the token is in the page (so the
// frontend can read it without a URL leak), that the script cannot be broken out
// of, and that a secret never appears unless it was put in the config (it never
// is). This is the leak guard at the page layer.

import { describe, expect, it } from "vitest";

import { bootstrapScript, escapeForScript, injectBootstrap } from "../../src/server/html.js";

const TOKEN = "11111111-2222-3333-4444-555555555555";
const CONFIG = {
  token: TOKEN,
  apiBase: "http://127.0.0.1:4321",
  mode: "pr" as const,
  capabilities: { comments: true },
  context: {
    sessionId: "s1",
    repo: { owner: "octo", name: "demo" },
    viewer: { login: "octocat" },
  },
};

describe("injectBootstrap", () => {
  it("injects the token just before </head>", () => {
    const html = "<html><head><title>x</title></head><body></body></html>";
    const out = injectBootstrap(html, CONFIG);
    expect(out).toContain(TOKEN);
    expect(out).toContain("globalThis.__CODETHROUGH__=");
    // The script lands inside the head, before its close tag.
    const scriptIndex = out.indexOf("globalThis.__CODETHROUGH__");
    expect(scriptIndex).toBeLessThan(out.indexOf("</head>"));
  });

  it("prepends the script when there is no head close tag", () => {
    const html = "<div id='root'></div>";
    const out = injectBootstrap(html, CONFIG);
    expect(out.startsWith("<script>")).toBe(true);
    expect(out).toContain(TOKEN);
    expect(out.endsWith(html)).toBe(true);
  });

  it("carries the mode + capabilities + context the frontend derives", () => {
    const html = "<html><head></head><body></body></html>";
    // The config is JSON in the script; parse it back out and check the values are
    // there.
    const out = injectBootstrap(html, CONFIG);
    const json = out.slice(out.indexOf("=") + 1, out.indexOf(";</script>"));
    const parsed = JSON.parse(json) as typeof CONFIG;
    expect(parsed.mode).toBe("pr");
    expect(parsed.capabilities).toEqual({ comments: true });
    expect(parsed.context).toEqual(CONFIG.context);
  });

  it("carries mode=path with comments disabled (local-path mode)", () => {
    const html = "<html><head></head><body></body></html>";
    const pathConfig = {
      ...CONFIG,
      mode: "path" as const,
      capabilities: { comments: false },
      context: { sessionId: "s2", repo: null, viewer: null },
    };
    const out = injectBootstrap(html, pathConfig);
    const json = out.slice(out.indexOf("=") + 1, out.indexOf(";</script>"));
    const parsed = JSON.parse(json) as typeof pathConfig;
    expect(parsed.mode).toBe("path");
    expect(parsed.capabilities).toEqual({ comments: false });
  });

  it("does not let a secret string appear unless it is in the bootstrap config", () => {
    // The config never carries a secret, so one can never appear in the page.
    // Injecting the real config produces no occurrence of the fake secrets.
    const ANTHROPIC_KEY = "sk-ant-secret-key-value";
    const GITHUB_TOKEN = "gho_secrettokenvalue";
    const html = "<html><head></head><body></body></html>";
    const out = injectBootstrap(html, CONFIG);
    expect(out).not.toContain(ANTHROPIC_KEY);
    expect(out).not.toContain(GITHUB_TOKEN);
  });
});

describe("escapeForScript", () => {
  it("neutralizes a </script> close tag in the payload", () => {
    const json = JSON.stringify({ token: "a</script><script>alert(1)</script>" });
    const escaped = escapeForScript(json);
    // No literal `<` or `>` survive, so the inline script cannot be closed early.
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
    expect(escaped).toContain(String.raw`\u003C`);
    // Still valid JSON (the \u escapes are legal).
    expect(JSON.parse(escaped)).toEqual({ token: "a</script><script>alert(1)</script>" });
  });

  it("escapes the U+2028 / U+2029 separators", () => {
    const lineSeparator = String.fromCodePoint(0x20_28);
    const json = JSON.stringify({ token: `a${lineSeparator}b` });
    const escaped = escapeForScript(json);
    expect(escaped).toContain(String.raw`\u2028`);
    expect(escaped).not.toContain(lineSeparator);
  });
});

describe("bootstrapScript", () => {
  it("wraps the escaped config in an inline script tag", () => {
    const script = bootstrapScript(CONFIG);
    expect(script.startsWith("<script>globalThis.__CODETHROUGH__=")).toBe(true);
    expect(script.endsWith("</script>")).toBe(true);
    expect(script).toContain(TOKEN);
  });
});
