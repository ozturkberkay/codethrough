// Tests for the server security checks: the exact-Host check (which rejects
// localhost), the Origin check (absent is allowed, a mismatch is rejected), and the
// token compare (accept and each reject). These guard the local server, so every
// branch is covered.

import { describe, expect, it } from "vitest";

import {
  authorized,
  bearerToken,
  expectedHost,
  expectedOrigin,
  hostAllowed,
  originAllowed,
  tokenMatches,
} from "../../src/server/security.js";

const PORT = 4_321;

describe("hostAllowed", () => {
  it("accepts the exact 127.0.0.1:<port>", () => {
    expect(hostAllowed(expectedHost(PORT), PORT)).toBe(true);
    expect(hostAllowed("127.0.0.1:4321", PORT)).toBe(true);
  });

  it("rejects localhost:<port> (DNS-rebinding defense)", () => {
    expect(hostAllowed("localhost:4321", PORT)).toBe(false);
  });

  it("rejects a wrong port, a foreign host, and a missing Host", () => {
    expect(hostAllowed("127.0.0.1:9999", PORT)).toBe(false);
    expect(hostAllowed("evil.example.com:4321", PORT)).toBe(false);
    expect(hostAllowed("127.0.0.1", PORT)).toBe(false);
    expect(hostAllowed(null, PORT)).toBe(false);
  });
});

describe("originAllowed", () => {
  it("accepts an absent Origin (same-origin GET may omit it)", () => {
    expect(originAllowed(null, PORT)).toBe(true);
  });

  it("accepts the exact http://127.0.0.1:<port>", () => {
    expect(originAllowed(expectedOrigin(PORT), PORT)).toBe(true);
    expect(originAllowed("http://127.0.0.1:4321", PORT)).toBe(true);
  });

  it("rejects a present, mismatched Origin", () => {
    expect(originAllowed("http://localhost:4321", PORT)).toBe(false);
    expect(originAllowed("https://127.0.0.1:4321", PORT)).toBe(false);
    expect(originAllowed("http://evil.example.com", PORT)).toBe(false);
  });
});

describe("tokenMatches (constant time)", () => {
  const TOKEN = "11111111-2222-3333-4444-555555555555";

  it("accepts the exact token", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
  });

  it("rejects a different token of equal length", () => {
    const other = "99999999-2222-3333-4444-555555555555";
    expect(other).toHaveLength(TOKEN.length);
    expect(tokenMatches(other, TOKEN)).toBe(false);
  });

  it("rejects a token of different length (no throw)", () => {
    expect(tokenMatches("short", TOKEN)).toBe(false);
    expect(tokenMatches(`${TOKEN}extra`, TOKEN)).toBe(false);
    expect(tokenMatches("", TOKEN)).toBe(false);
  });
});

describe("bearerToken", () => {
  it("extracts the token from a Bearer header (scheme case-insensitive)", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer abc123")).toBe("abc123");
    expect(bearerToken("  Bearer abc123  ")).toBe("abc123");
  });

  it("returns null for an absent or non-Bearer header", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Basic abc123")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
  });
});

describe("authorized", () => {
  const TOKEN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("accepts a correct Bearer token", () => {
    expect(authorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("rejects a missing header, a wrong scheme, and a wrong token", () => {
    expect(authorized(null, TOKEN)).toBe(false);
    expect(authorized("Basic x", TOKEN)).toBe(false);
    expect(authorized("Bearer wrong-token-value-here-padded-to-len", TOKEN)).toBe(false);
  });
});
