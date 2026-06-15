// Tests for the response builders, mainly the parts the integration path misses:
// the mid-stream error frame and the rejection shape. The no-referrer header is
// checked too.

import type { WalkthroughChunk } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import {
  rejectResponse,
  streamErrorMessage,
  walkthroughResponse,
} from "../../src/server/responses.js";

const readBody = async (response: Response): Promise<string> => await response.text();

describe("rejectResponse", () => {
  it("carries the status, the reason body, and the no-referrer policy", async () => {
    const res = rejectResponse(403, "host not allowed");
    expect(res.status).toBe(403);
    expect(await readBody(res)).toBe("host not allowed");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("walkthroughResponse", () => {
  it("frames each chunk and sends an SSE content type", async () => {
    const chunks: WalkthroughChunk[] = [{ type: "done" }];
    const res = walkthroughResponse(
      (async function* gen(): AsyncIterable<WalkthroughChunk> {
        for (const chunk of chunks) {
          yield chunk;
        }
      })(),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await readBody(res)).toContain('"type":"done"');
  });

  it("emits a terminal error frame when the stream throws mid-way", async () => {
    const res = walkthroughResponse(
      (async function* gen(): AsyncIterable<WalkthroughChunk> {
        yield {
          type: "summary",
          summary: { problem: "p", statusQuo: "s", solution: "x", keyDecisions: [] },
        };
        throw new Error("engine blew up");
      })(),
    );
    const body = await readBody(res);
    // The summary frame is delivered, then a parse-kind error frame with the message.
    expect(body).toContain('"type":"summary"');
    expect(body).toContain('"type":"error"');
    expect(body).toContain("engine blew up");
  });
});

describe("streamErrorMessage", () => {
  it("uses an Error's message", () => {
    expect(streamErrorMessage(new Error("engine blew up"))).toBe("engine blew up");
  });

  it("falls back to a generic message for a non-Error value", () => {
    expect(streamErrorMessage({ reason: "boom" })).toBe("stream failed");
    expect(streamErrorMessage("boom")).toBe("stream failed");
    expect(streamErrorMessage(null)).toBe("stream failed");
  });
});
