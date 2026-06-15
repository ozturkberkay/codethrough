// Decides what to do with each request, without doing any I/O itself. All the
// security checks live here so they are easy to test:
//
//   1. Check the Host on every request (even GET /), so only our address works.
//   2. For /api/* only: check the Origin, then check the token (401 on a miss).
//   3. Match the method and path to an API route, or serve a static file.
//
// The result is plain data; the serve shell turns it into a real Response.

import { authorized, hostAllowed, originAllowed } from "./security.js";

// The parts of a request the router looks at: method, path, query, and the three
// headers it checks. The shell fills this in so the router never sees a Request.
interface RequestInfo {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  host: string | null;
  origin: string | null;
  authorization: string | null;
}

// What the guards check against: our port and the run's secret token.
interface RouterConfig {
  port: number;
  token: string;
}

// The router's answer. A reject has a status and reason; an api decision names
// the matched route (plus a jobId where needed); a static decision asks the
// shell to serve a frontend file.
type RouteDecision =
  | { kind: "reject"; status: number; reason: string }
  | { kind: "api"; route: "review" }
  | { kind: "api"; route: "comments" }
  | { kind: "api"; route: "comments_stream" }
  | { kind: "api"; route: "drafts" }
  | { kind: "api"; route: "draft_comment" }
  | { kind: "api"; route: "submit_review" }
  | { kind: "api"; route: "walkthrough_start" }
  | { kind: "api"; route: "walkthrough_stream"; jobId: string }
  | { kind: "api"; route: "walkthrough_cancel"; jobId: string }
  | { kind: "static"; pathname: string };

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;

const API_PREFIX = "/api/";

// Return the decision when the method matches, else a 405. Keeps each
// single-method route below a one-liner.
const methodRoute = (method: string, expected: string, decision: RouteDecision): RouteDecision =>
  method === expected
    ? decision
    : { kind: "reject", status: HTTP_METHOD_NOT_ALLOWED, reason: "method not allowed" };

// The simple API routes (everything but /api/walkthrough, which has its own
// verbs). Returns undefined when the path is none of these.
const matchFixedRoute = (info: RequestInfo): RouteDecision | undefined => {
  switch (info.pathname) {
    case "/api/review": {
      return methodRoute(info.method, "GET", { kind: "api", route: "review" });
    }
    case "/api/comments": {
      return methodRoute(info.method, "GET", { kind: "api", route: "comments" });
    }
    case "/api/comments/stream": {
      return methodRoute(info.method, "GET", { kind: "api", route: "comments_stream" });
    }
    case "/api/comments/draft": {
      return methodRoute(info.method, "POST", { kind: "api", route: "draft_comment" });
    }
    case "/api/drafts": {
      return methodRoute(info.method, "GET", { kind: "api", route: "drafts" });
    }
    case "/api/review/submit": {
      return methodRoute(info.method, "POST", { kind: "api", route: "submit_review" });
    }
    default: {
      return undefined;
    }
  }
};

// Route an /api/* request: check the Origin and token first, then match the
// path. A failed check returns a reject right away.
const routeApi = (info: RequestInfo, config: RouterConfig): RouteDecision => {
  if (!originAllowed(info.origin, config.port)) {
    return { kind: "reject", status: HTTP_FORBIDDEN, reason: "origin not allowed" };
  }
  if (!authorized(info.authorization, config.token)) {
    return { kind: "reject", status: HTTP_UNAUTHORIZED, reason: "missing or invalid bearer token" };
  }

  const fixed = matchFixedRoute(info);
  if (fixed !== undefined) {
    return fixed;
  }
  if (info.pathname === "/api/walkthrough") {
    return routeWalkthrough(info);
  }
  return { kind: "reject", status: HTTP_NOT_FOUND, reason: "no such api route" };
};

// The /api/walkthrough verbs: POST starts a job, GET streams it, DELETE cancels
// it. Streaming and cancelling need a jobId in the query.
const routeWalkthrough = (info: RequestInfo): RouteDecision => {
  if (info.method === "POST") {
    return { kind: "api", route: "walkthrough_start" };
  }
  if (info.method === "GET" || info.method === "DELETE") {
    const jobId = info.searchParams.get("jobId");
    if (jobId === null || jobId === "") {
      return { kind: "reject", status: HTTP_BAD_REQUEST, reason: "jobId is required" };
    }
    return info.method === "GET"
      ? { kind: "api", route: "walkthrough_stream", jobId }
      : { kind: "api", route: "walkthrough_cancel", jobId };
  }
  return { kind: "reject", status: HTTP_METHOD_NOT_ALLOWED, reason: "method not allowed" };
};

// Route a request. Check the Host first on every path; then /api/* goes through
// the API checks, and anything else is a static file.
const route = (info: RequestInfo, config: RouterConfig): RouteDecision => {
  if (!hostAllowed(info.host, config.port)) {
    return { kind: "reject", status: HTTP_FORBIDDEN, reason: "host not allowed" };
  }
  if (info.pathname === "/api" || info.pathname.startsWith(API_PREFIX)) {
    return routeApi(info, config);
  }
  return { kind: "static", pathname: info.pathname };
};

export { route };
export type { RequestInfo, RouteDecision, RouterConfig };
