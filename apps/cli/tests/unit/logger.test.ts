// Unit tests for the process-stream logger: info writes to out, error writes to
// err, each with a trailing newline. No console.* (oxlint forbids it).

import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/logger.js";

describe("createLogger", () => {
  it("writes info to out and error to err, each newline-terminated", () => {
    const out: string[] = [];
    const err: string[] = [];
    const logger = createLogger({
      out: { write: (chunk) => out.push(String(chunk)) },
      err: { write: (chunk) => err.push(String(chunk)) },
    });
    logger.info("hello");
    logger.error("oops");
    expect(out).toEqual(["hello\n"]);
    expect(err).toEqual(["oops\n"]);
  });
});
