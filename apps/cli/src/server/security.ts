// Security checks for the local server. The server holds the Anthropic key and
// GitHub token, so these guards keep other programs and websites out:
//
//   - hostAllowed: only accept requests addressed to 127.0.0.1:<port>.
//   - originAllowed: only accept API requests from our own page.
//   - tokenMatches: check the secret token without leaking it through timing.
//
// They take plain strings, not a Request, so they are easy to test and reuse.

import { timingSafeEqual } from "node:crypto";

// The only host we answer to. We reject "localhost" on purpose so a malicious
// site cannot point a name at our loopback address and reach us.
const LOOPBACK_HOST = "127.0.0.1";

// The exact Host value we require, like `127.0.0.1:3000`.
const expectedHost = (port: number): string => `${LOOPBACK_HOST}:${port}`;

// The exact Origin value we require, like `http://127.0.0.1:3000`.
const expectedOrigin = (port: number): string => `http://${LOOPBACK_HOST}:${port}`;

// Accept only the exact Host. A missing Host is rejected, since real requests
// always send one.
const hostAllowed = (host: string | null, port: number): boolean => host === expectedHost(port);

// Accept a missing Origin (some same-site requests omit it) or our exact Origin.
// Any other Origin is a different site and is rejected.
const originAllowed = (origin: string | null, port: number): boolean =>
  origin === null || origin === expectedOrigin(port);

// Compare the token without leaking it through timing. We check the length first
// (the length is not secret) because the compare below throws on a mismatch.
const tokenMatches = (provided: string, expected: string): boolean => {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
};

// Pull the token out of an `Authorization: Bearer <token>` header, or null when
// it is missing or not a Bearer header. The word "Bearer" is case-insensitive.
const bearerToken = (authorization: string | null): string | null => {
  if (authorization === null) {
    return null;
  }
  const match = /^Bearer (.+)$/i.exec(authorization.trim());
  return match === null ? null : (match[1] as string);
};

// True when the request carries the correct token. A missing or non-Bearer
// header is rejected.
const authorized = (authorization: string | null, expectedToken: string): boolean => {
  const provided = bearerToken(authorization);
  if (provided === null) {
    return false;
  }
  return tokenMatches(provided, expectedToken);
};

export {
  authorized,
  bearerToken,
  expectedHost,
  expectedOrigin,
  hostAllowed,
  originAllowed,
  tokenMatches,
};
