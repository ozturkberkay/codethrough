// The server shell: the only place that opens a socket. It builds the router
// input from a real Request, runs the router, and either dispatches an API call
// or serves a frontend file. Not unit-tested (the socket + file reads are edges);
// the logic it calls is.
//
// SECURITY: every request goes through the router first. The served page gets the
// run's token injected (html.ts) so the token never shows up in a URL.
//
// This shell wires the server's pieces together, so it imports broadly on purpose.
/* oxlint-disable import/max-dependencies */

import { embeddedAssetPath, isCompiledBinary } from "./embedded_registry.js";
import { handleDecision } from "./handle.js";
import { type BootstrapConfig, injectBootstrap } from "./html.js";
import { BASE_HEADERS } from "./responses.js";
import type { ServerReviewSource } from "./review_source.js";
import { type RequestInfo, route, type RouterConfig } from "./router.js";
import {
  contentTypeFor,
  embeddedIndexPath,
  type EmbeddedSource,
  resolveAssetPath,
  resolveServedAsset,
} from "./static_assets.js";

// A running server: its port, the run's token, and a stop() that closes it.
interface RunningServer {
  port: number;
  token: string;
  stop: () => void;
}

// Everything the server needs to run. The source produces the review data;
// distDir holds the built frontend; token and port are this run's settings.
// onActivity (optional) runs on each /api request so the idle timer can reset.
interface ServeOptions {
  source: ServerReviewSource;
  distDir: string;
  port: number;
  token: string;
  onActivity?: () => void;
}

const HTTP_NOT_FOUND = 404;
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

// Build the router's input from a real Request and its URL.
const toRequestInfo = (request: Request, url: URL): RequestInfo => ({
  method: request.method,
  pathname: url.pathname,
  searchParams: url.searchParams,
  host: request.headers.get("host"),
  origin: request.headers.get("origin"),
  authorization: request.headers.get("authorization"),
});

// Build the data we put in the page: the token plus the mode and capabilities.
// Sending these in the page lets the frontend show the right write UI without a
// failed request first. No secret beyond the token goes here.
const bootstrapFor = (options: ServeOptions): BootstrapConfig => {
  const { context, capabilities } = options.source;
  return {
    token: options.token,
    apiBase: "",
    mode: context.mode,
    capabilities: { comments: capabilities.comments },
    context: { sessionId: context.sessionId, repo: context.repo, viewer: context.viewer },
  };
};

// Build the HTML response for the app, with the token and config injected into
// the page so the frontend reads it from there, never the URL.
const htmlResponse = async (
  file: ReturnType<typeof Bun.file>,
  options: ServeOptions,
): Promise<Response> => {
  const html = injectBootstrap(await file.text(), bootstrapFor(options));
  return new Response(html, { headers: { ...BASE_HEADERS, "Content-Type": HTML_CONTENT_TYPE } });
};

// How this process finds assets: whether they were baked into the binary, and
// the lookup for them. Checked per request so one code path serves both disk and
// binary.
const embeddedSource = (): EmbeddedSource => ({
  compiled: isCompiledBinary(),
  lookup: embeddedAssetPath,
});

// The index.html to fall back to: the baked-in one for a binary, or the on-disk
// one in dev. Null only when a binary somehow has no index (guarded).
const indexPath = (distDir: string, source: EmbeddedSource): string | null =>
  source.compiled ? embeddedIndexPath(source.lookup) : resolveAssetPath(distDir, "/");

// Serve one static file from the binary or from disk. The page gets the token
// injected; other files stream as-is. An unknown path falls back to index.html so
// client-side routing works; a missing index is a 404.
const serveStatic = async (options: ServeOptions, pathname: string): Promise<Response> => {
  const source = embeddedSource();
  const assetPath = resolveServedAsset(options.distDir, pathname, source);
  if (assetPath !== null) {
    const file = Bun.file(assetPath);
    if (await file.exists()) {
      if (assetPath.endsWith(".html")) {
        return htmlResponse(file, options);
      }
      const type = contentTypeFor(assetPath);
      return new Response(file, {
        headers: { ...BASE_HEADERS, ...(type ? { "Content-Type": type } : {}) },
      });
    }
  }

  const fallback = indexPath(options.distDir, source);
  if (fallback !== null) {
    const indexFile = Bun.file(fallback);
    if (await indexFile.exists()) {
      return htmlResponse(indexFile, options);
    }
  }
  return new Response("not found", {
    status: HTTP_NOT_FOUND,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
};

// The two API routes that send a JSON body. The shell reads the body for these,
// since the router does not.
const BODY_ROUTES = new Set(["draft_comment", "submit_review"]);

// Parse a request's JSON body, or undefined when it is missing or malformed. The
// route handler validates the value, so a bad body becomes a 400 there.
const readJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
};

// Handle one request: route it against the real bound port (so the Host check
// matches), then dispatch or serve a file. boundPort is the port Bun gave us,
// which differs from the requested one when port 0 (any free port) was asked for.
// The request signal is passed to streaming routes so a disconnect stops the
// comments poller.
const handleRequest = (
  options: ServeOptions,
  boundPort: number,
  request: Request,
): Response | Promise<Response> => {
  const url = new URL(request.url);
  const config: RouterConfig = { port: boundPort, token: options.token };
  const decision = route(toRequestInfo(request, url), config);
  if (decision.kind === "static") {
    return serveStatic(options, decision.pathname);
  }
  // Any /api request counts as activity, so reset the idle timer and keep an
  // active session alive.
  options.onActivity?.();
  if (decision.kind === "api" && BODY_ROUTES.has(decision.route)) {
    return readJsonBody(request).then((body) =>
      handleDecision(decision, options.source, { body, signal: request.signal }),
    );
  }
  return handleDecision(decision, options.source, { signal: request.signal });
};

// Start the server on 127.0.0.1. Binding to loopback (not 0.0.0.0) keeps it off
// the network and is the first part of our security model. The handler reads the
// real bound port (known only after starting) so the Host check uses it even when
// port 0 was requested.
const startServer = (options: ServeOptions): RunningServer => {
  let boundPort = options.port;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    fetch: (request) => handleRequest(options, boundPort, request),
  });
  // The port we actually got; fall back to the requested one to satisfy the type.
  boundPort = server.port ?? options.port;
  return {
    port: boundPort,
    token: options.token,
    stop: () => {
      void server.stop(true);
    },
  };
};

export { handleRequest, startServer };
export type { RunningServer, ServeOptions };
