// Integration: start the real server in-process with fake review data and a fake
// engine, then drive it with real fetch to prove the security model end to end:
//
//   - a missing or invalid token -> 401 (including on the stream route)
//   - a wrong Host -> 403
//   - a wrong Origin -> 403
//   - a valid token and host -> GET /api/review returns the fake data
//   - GET /api/walkthrough streams the summary, step, and done frames
//   - the token is injected into the served page (never the URL)
//   - a leak scan: no response (body or headers) ever contains the fake secrets
//
// The server runs on 127.0.0.1 on a free port and is stopped after.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WalkthroughChunk } from "@codethrough/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createReviewSource } from "../../src/server/review_source.js";
import { startServer } from "../../src/server/serve.js";
import {
  FAKE_ANTHROPIC_KEY,
  FAKE_GITHUB_TOKEN,
  FIXTURE_CHUNKS,
  FIXTURE_CONTEXT,
  FIXTURE_REVIEW,
} from "../fixtures/review_fixture.js";

const TOKEN = "test-bearer-0000-1111-2222-333344445555";

// A fake walkthrough that yields the fixture chunks (no engine, no API).
const fakeRunner = (signal: AbortSignal): AsyncIterable<WalkthroughChunk> =>
  (async function* gen(): AsyncIterable<WalkthroughChunk> {
    for (const chunk of FIXTURE_CHUNKS) {
      if (signal.aborted) {
        return;
      }
      yield chunk;
    }
  })();

// Start the server once for the suite over a temp dist with an index.html, so the
// token injection and HTML leak scan run. The write and live routes have their own
// server in server_writes.test.ts to keep the draft state separate. The handle and
// addresses are filled in by beforeAll.
let serverHandle: ReturnType<typeof startServer> | null = null;
let base = "";
let host = "";
let distRoot = "";

beforeAll(() => {
  distRoot = mkdtempSync(join(tmpdir(), "ct-cli-dist-"));
  writeFileSync(
    join(distRoot, "index.html"),
    "<!doctype html><html><head><title>x</title></head><body><div id=root></div></body></html>",
  );
  // The write and live helpers are present so comments are on; the write routes
  // are exercised in server_writes.test.ts.
  const source = createReviewSource({
    data: FIXTURE_REVIEW,
    context: FIXTURE_CONTEXT,
    runWalkthrough: fakeRunner,
    wait: async () => {},
    intervalMs: 1_000,
    submit: async () => ({ htmlUrl: "https://example.com/r/1" }),
    fetchComments: async () => FIXTURE_REVIEW.comments,
  });
  const server = startServer({ source, distDir: distRoot, port: 0, token: TOKEN });
  serverHandle = server;
  base = `http://127.0.0.1:${server.port}`;
  host = `127.0.0.1:${server.port}`;
});

afterAll(() => {
  serverHandle?.stop();
  rmSync(distRoot, { recursive: true, force: true });
});

// Standard valid headers for an api request.
const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${TOKEN}`,
  Host: host,
  Origin: `http://${host}`,
});

describe("server: bearer guard", () => {
  it("rejects a missing bearer token with 401", async () => {
    const res = await fetch(`${base}/api/review`, { headers: { Host: host } });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token with 401", async () => {
    const res = await fetch(`${base}/api/review`, {
      headers: { Host: host, Authorization: "Bearer wrong-token-padded-to-some-length-xxxx" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects the SSE route without a bearer token (401, SSE included)", async () => {
    const res = await fetch(`${base}/api/walkthrough?jobId=x`, { headers: { Host: host } });
    expect(res.status).toBe(401);
  });
});

describe("server: Host guard", () => {
  it("rejects a wrong Host (DNS-rebinding defense)", async () => {
    const res = await fetch(`${base}/api/review`, {
      headers: { ...authHeaders(), Host: "localhost:1" },
    });
    expect(res.status).toBe(403);
  });
});

describe("server: Origin guard", () => {
  it("rejects a mismatched Origin", async () => {
    const res = await fetch(`${base}/api/review`, {
      headers: { ...authHeaders(), Origin: "http://evil.example.com" },
    });
    expect(res.status).toBe(403);
  });
});

describe("server: review + comments", () => {
  it("returns the fake review for a valid token + host", async () => {
    const res = await fetch(`${base}/api/review`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await res.json();
    expect(body).toEqual(FIXTURE_REVIEW);
  });

  it("returns the placed comments", async () => {
    const res = await fetch(`${base}/api/comments`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FIXTURE_REVIEW.comments);
  });
});

describe("server: walkthrough SSE", () => {
  it("starts a job then streams summary + step + usage + done frames", async () => {
    const startRes = await fetch(`${base}/api/walkthrough`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(startRes.status).toBe(200);
    const { jobId } = (await startRes.json()) as { jobId: string };
    expect(jobId).toBeTruthy();

    const streamRes = await fetch(`${base}/api/walkthrough?jobId=${encodeURIComponent(jobId)}`, {
      headers: authHeaders(),
    });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");

    const text = await streamRes.text();
    // Each chunk is its own data line.
    const types = text
      .split("\n\n")
      .filter((frame) => frame.startsWith("data:"))
      .map((frame) => JSON.parse(frame.slice("data:".length).trim()).type);
    expect(types).toEqual(["summary", "step", "usage", "done"]);
  });
});

describe("server: static frontend", () => {
  it("serves index.html with the bearer token injected (not in the URL)", async () => {
    const res = await fetch(`${base}/`, { headers: { Host: host } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("globalThis.__CODETHROUGH__");
    expect(html).toContain(TOKEN);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

// The leak test: scan every route's response (body and headers) and check the
// secrets never appear. The secrets live only in the auth and engine layer; the
// routes serve review data, chunks, or the page, none of which carry one.
describe("server: response-leak scan", () => {
  const probe = async (path: string, init?: RequestInit): Promise<string> => {
    const res = await fetch(`${base}${path}`, {
      headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
      ...init,
    });
    const headerDump = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    return `${headerDump}\n${await res.text()}`;
  };

  it("never leaks the Anthropic key or GitHub token on any route", async () => {
    const startRes = await fetch(`${base}/api/walkthrough`, {
      method: "POST",
      headers: authHeaders(),
    });
    const { jobId } = (await startRes.json()) as { jobId: string };

    const dumps = await Promise.all([
      probe("/api/review"),
      probe("/api/comments"),
      probe(`/api/walkthrough?jobId=${encodeURIComponent(jobId)}`),
      probe("/"),
      probe("/api/review", { headers: { Authorization: "Bearer nope-nope-nope-nope-nope-padxx" } }),
    ]);
    for (const dump of dumps) {
      expect(dump).not.toContain(FAKE_ANTHROPIC_KEY);
      expect(dump).not.toContain(FAKE_GITHUB_TOKEN);
    }
  });
});
