// Tests for the request router: the Host check runs for every path, the Origin and
// token checks gate /api/*, and each API verb and path maps to its decision.
// Covers accept and every reject, so the security logic is proven without a socket.

import { describe, expect, it } from "vitest";

import { type RequestInfo, route, type RouterConfig } from "../../src/server/router.js";

const PORT = 4_321;
const TOKEN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CONFIG: RouterConfig = { port: PORT, token: TOKEN };

// Build a request with valid Host, Origin, and token by default, so each test
// overrides just the one field it cares about.
const req = (over: Partial<RequestInfo> = {}): RequestInfo => ({
  method: "GET",
  pathname: "/api/review",
  searchParams: new URLSearchParams(),
  host: `127.0.0.1:${PORT}`,
  origin: `http://127.0.0.1:${PORT}`,
  authorization: `Bearer ${TOKEN}`,
  ...over,
});

describe("route: Host guard", () => {
  it("rejects a wrong Host for an api path", () => {
    const decision = route(req({ host: "localhost:4321" }), CONFIG);
    expect(decision).toEqual({ kind: "reject", status: 403, reason: "host not allowed" });
  });

  it("rejects a wrong Host for a static path too", () => {
    const decision = route(req({ pathname: "/", host: "evil.com:4321" }), CONFIG);
    expect(decision).toEqual({ kind: "reject", status: 403, reason: "host not allowed" });
  });
});

describe("route: Origin + bearer guards on /api/*", () => {
  it("rejects a mismatched Origin", () => {
    const decision = route(req({ origin: "http://localhost:4321" }), CONFIG);
    expect(decision).toEqual({ kind: "reject", status: 403, reason: "origin not allowed" });
  });

  it("rejects a missing bearer token with 401", () => {
    const decision = route(req({ authorization: null }), CONFIG);
    expect(decision).toEqual({
      kind: "reject",
      status: 401,
      reason: "missing or invalid bearer token",
    });
  });

  it("rejects an invalid bearer token with 401", () => {
    const decision = route(
      req({ authorization: "Bearer wrong-token-of-the-same-length-padxx" }),
      CONFIG,
    );
    expect(decision.kind).toBe("reject");
    if (decision.kind === "reject") {
      expect(decision.status).toBe(401);
    }
  });

  it("accepts an absent Origin (same-origin GET)", () => {
    const decision = route(req({ origin: null }), CONFIG);
    expect(decision).toEqual({ kind: "api", route: "review" });
  });
});

describe("route: api route matching", () => {
  it("maps GET /api/review", () => {
    expect(route(req({ pathname: "/api/review" }), CONFIG)).toEqual({
      kind: "api",
      route: "review",
    });
  });

  it("maps GET /api/comments", () => {
    expect(route(req({ pathname: "/api/comments" }), CONFIG)).toEqual({
      kind: "api",
      route: "comments",
    });
  });

  it("maps POST /api/walkthrough to start", () => {
    expect(route(req({ pathname: "/api/walkthrough", method: "POST" }), CONFIG)).toEqual({
      kind: "api",
      route: "walkthrough_start",
    });
  });

  it("maps GET /api/walkthrough?jobId= to stream", () => {
    const decision = route(
      req({ pathname: "/api/walkthrough", searchParams: new URLSearchParams({ jobId: "j1" }) }),
      CONFIG,
    );
    expect(decision).toEqual({ kind: "api", route: "walkthrough_stream", jobId: "j1" });
  });

  it("maps DELETE /api/walkthrough?jobId= to cancel", () => {
    const decision = route(
      req({
        pathname: "/api/walkthrough",
        method: "DELETE",
        searchParams: new URLSearchParams({ jobId: "j1" }),
      }),
      CONFIG,
    );
    expect(decision).toEqual({ kind: "api", route: "walkthrough_cancel", jobId: "j1" });
  });

  it("rejects a stream/cancel with no jobId", () => {
    const decision = route(req({ pathname: "/api/walkthrough" }), CONFIG);
    expect(decision).toEqual({ kind: "reject", status: 400, reason: "jobId is required" });
  });

  it("rejects the wrong method on a route with 405", () => {
    const decision = route(req({ pathname: "/api/review", method: "POST" }), CONFIG);
    expect(decision).toEqual({ kind: "reject", status: 405, reason: "method not allowed" });
  });

  it("rejects an unknown api route with 404", () => {
    const decision = route(req({ pathname: "/api/nope" }), CONFIG);
    expect(decision).toEqual({ kind: "reject", status: 404, reason: "no such api route" });
  });

  it("rejects an unknown walkthrough verb with 405", () => {
    const decision = route(req({ pathname: "/api/walkthrough", method: "PUT" }), CONFIG);
    expect(decision).toEqual({ kind: "reject", status: 405, reason: "method not allowed" });
  });
});

describe("route: static fallthrough", () => {
  it("classifies a non-api path as static (Host already checked)", () => {
    expect(route(req({ pathname: "/", authorization: null, origin: null }), CONFIG)).toEqual({
      kind: "static",
      pathname: "/",
    });
    expect(route(req({ pathname: "/assets/app.js", authorization: null }), CONFIG)).toEqual({
      kind: "static",
      pathname: "/assets/app.js",
    });
  });
});
