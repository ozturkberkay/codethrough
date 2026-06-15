// Integration: the write and live routes against the real server with fake helpers
// (a GitHub submit and a comment fetch), driven by real fetch. Proves end to end:
//
//   - an unauthenticated draft, submit, or stream -> 401
//   - a posted draft persists and lists back; an invalid draft -> 400
//   - submit sends the stored drafts to the fake GitHub submit, clears them, and
//     returns the review url
//   - the comments stream sends a frame when the fetch reports a change
//   - the no-leak rule still holds for the write routes
//
// A separate server from server.test.ts so the draft state stays separate.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Comment } from "@codethrough/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createReviewSource } from "../../src/server/review_source.js";
import { startServer } from "../../src/server/serve.js";
import {
  FAKE_ANTHROPIC_KEY,
  FAKE_GITHUB_TOKEN,
  FIXTURE_CONTEXT,
  FIXTURE_REVIEW,
} from "../fixtures/review_fixture.js";

const TOKEN = "writes-bearer-0000-1111-2222-33334444";

// A no-op walkthrough (unused here, but the source needs one).
const noopRunner = async function* noopRunnerGen(): AsyncIterable<never> {
  // Yields nothing on purpose.
};

// Records the submit payloads the source sent.
const submittedPayloads: { event: string; comments: number }[] = [];

// The lists the poll fetch returns, one per poll. Once they run out the fetch
// throws, which ends the stream so `res.text()` finishes predictably.
let liveSnapshots: Comment[][] = [];

class LiveStreamDone extends Error {}

const fakeSubmit = async (payload: {
  event: string;
  comments?: unknown[];
}): Promise<{ htmlUrl: string }> => {
  submittedPayloads.push({ event: payload.event, comments: payload.comments?.length ?? 0 });
  return await Promise.resolve({
    htmlUrl: "https://github.com/octo/demo/pull/7#pullrequestreview-9",
  });
};

const fakeFetchComments = async (): Promise<Comment[]> => {
  if (liveSnapshots.length === 0) {
    throw new LiveStreamDone("no more snapshots");
  }
  return await Promise.resolve(liveSnapshots.shift()!);
};

let serverHandle: ReturnType<typeof startServer> | null = null;
let base = "";
let host = "";
let distRoot = "";

beforeAll(() => {
  distRoot = mkdtempSync(join(tmpdir(), "ct-cli-writes-"));
  writeFileSync(join(distRoot, "index.html"), "<!doctype html><html><body></body></html>");
  const source = createReviewSource({
    data: FIXTURE_REVIEW,
    context: FIXTURE_CONTEXT,
    runWalkthrough: noopRunner,
    // An immediate wait so the poll loop runs with no real delay.
    wait: async () => {},
    intervalMs: 1_000,
    submit: fakeSubmit,
    fetchComments: fakeFetchComments,
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

// A valid draft body the write tests post.
const DRAFT_BODY = {
  path: "src/greet.ts",
  body: "Was this debug log meant to ship?",
  line: 2,
  side: "RIGHT",
  startLine: null,
  startSide: null,
  subjectType: "line",
};

// POST a draft body with the bearer header.
const postDraft = (body: unknown): Promise<Response> =>
  fetch(`${base}/api/comments/draft`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Clear the shared draft store with a submit before each test, then reset the
// recorders so a draft does not carry over between tests.
beforeEach(async () => {
  await fetch(`${base}/api/review/submit`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ event: "COMMENT" }),
  });
  submittedPayloads.length = 0;
  liveSnapshots = [];
});

describe("server writes: auth guards", () => {
  it("rejects an unauthenticated draft POST with 401", async () => {
    const res = await fetch(`${base}/api/comments/draft`, {
      method: "POST",
      headers: { Host: host, "Content-Type": "application/json" },
      body: JSON.stringify(DRAFT_BODY),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unauthenticated submit POST with 401", async () => {
    const res = await fetch(`${base}/api/review/submit`, {
      method: "POST",
      headers: { Host: host, "Content-Type": "application/json" },
      body: JSON.stringify({ event: "COMMENT" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unauthenticated stream subscribe with 401", async () => {
    const res = await fetch(`${base}/api/comments/stream`, { headers: { Host: host } });
    expect(res.status).toBe(401);
  });
});

describe("server writes: draft + submit", () => {
  it("persists a posted draft and lists it back", async () => {
    const post = await postDraft(DRAFT_BODY);
    expect(post.status).toBe(201);
    expect(await post.json()).toEqual({ draft: DRAFT_BODY });

    const list = await fetch(`${base}/api/drafts`, { headers: authHeaders() });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([DRAFT_BODY]);
  });

  it("rejects a schema-invalid draft with 400", async () => {
    const res = await postDraft({ nonsense: true });
    expect(res.status).toBe(400);
  });

  it("submits the stored drafts as one review, clears them, and returns the url", async () => {
    await postDraft(DRAFT_BODY);
    await postDraft({ ...DRAFT_BODY, body: "Second note." });

    const submit = await fetch(`${base}/api/review/submit`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ event: "COMMENT", body: "A couple of notes." }),
    });
    expect(submit.status).toBe(200);
    expect(await submit.json()).toEqual({
      htmlUrl: "https://github.com/octo/demo/pull/7#pullrequestreview-9",
    });
    // The fake submit got both drafts, then they were cleared.
    expect(submittedPayloads).toEqual([{ event: "COMMENT", comments: 2 }]);
    const list = await fetch(`${base}/api/drafts`, { headers: authHeaders() });
    expect(await list.json()).toEqual([]);
  });
});

describe("server writes: comments stream (live deltas)", () => {
  it("emits a delta frame when the live fetch reports a new comment", async () => {
    const seeded = FIXTURE_REVIEW.comments[0]!;
    const added: Comment = { ...seeded, id: "c-new", body: "A freshly posted comment." };
    liveSnapshots = [[seeded, added]];

    const res = await fetch(`${base}/api/comments/stream`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const frames = text
      .split("\n\n")
      .filter((frame) => frame.startsWith("data:"))
      .map((frame) => JSON.parse(frame.slice("data:".length).trim()));
    expect(frames).toHaveLength(1);
    expect(frames[0].added.map((c: Comment) => c.id)).toEqual(["c-new"]);
  });

  it("closes the comments stream CLEANLY (no error frame) when the fetch rejects mid-stream", async () => {
    // No lists queued, so the first poll's fetch rejects. The stream must end with
    // no error frame; the frontend keeps its last comments. The walkthrough stream
    // does send an error frame on a failure, but the comments stream does not.
    liveSnapshots = [];
    const res = await fetch(`${base}/api/comments/stream`, { headers: authHeaders() });
    expect(res.status).toBe(200);

    const text = await res.text();
    // No error frame (a failed comment fetch ends the stream quietly).
    expect(text).not.toContain('"type":"error"');
    // No change frame either (the fetch failed before making one).
    expect(text.split("\n\n").filter((frame) => frame.startsWith("data:"))).toHaveLength(0);
  });
});

// The no-leak rule for the write routes: a draft or submit response (body and
// headers) never carries a secret.
describe("server writes: response-leak scan", () => {
  it("never leaks the secrets on the draft or submit routes", async () => {
    await postDraft(DRAFT_BODY);
    const probe = async (path: string, init: RequestInit): Promise<string> => {
      const res = await fetch(`${base}${path}`, {
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        ...init,
      });
      const headerDump = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
      return `${headerDump}\n${await res.text()}`;
    };
    const dumps = await Promise.all([
      probe("/api/drafts", { method: "GET" }),
      probe("/api/review/submit", { method: "POST", body: JSON.stringify({ event: "COMMENT" }) }),
    ]);
    for (const dump of dumps) {
      expect(dump).not.toContain(FAKE_ANTHROPIC_KEY);
      expect(dump).not.toContain(FAKE_GITHUB_TOKEN);
    }
  });
});
