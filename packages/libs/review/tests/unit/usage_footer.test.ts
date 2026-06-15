// Tests for formatting the cost and elapsed-time footer, including the
// elapsed-only state before the token counts arrive.

import { describe, expect, it } from "vitest";

import {
  formatCost,
  formatElapsed,
  formatTokens,
  formatUsageFooter,
} from "../../src/usage_footer.js";

describe("formatCost", () => {
  it("formats a sub-cent cost to four decimals with a $ prefix", () => {
    expect(formatCost(0.0123)).toBe("$0.0123");
  });

  it("formats a whole-dollar cost", () => {
    expect(formatCost(6)).toBe("$6.0000");
  });
});

describe("formatElapsed", () => {
  it("formats seconds to one decimal", () => {
    expect(formatElapsed(12.37)).toBe("12.4s");
    expect(formatElapsed(0)).toBe("0.0s");
  });
});

describe("formatTokens", () => {
  it("adds thousands separators", () => {
    expect(formatTokens(1_000)).toBe("1,000");
    expect(formatTokens(40_000)).toBe("40,000");
    expect(formatTokens(7)).toBe("7");
  });
});

describe("formatUsageFooter", () => {
  it("shows only the elapsed time before the usage chunk arrives", () => {
    expect(formatUsageFooter(null, 3.2)).toBe("3.2s");
  });

  it("shows cost, elapsed, and the token split once usage is known", () => {
    const usage = { inputTokens: 1_000, outputTokens: 40_000, costUsd: 0.0123 };
    expect(formatUsageFooter(usage, 12.4)).toBe("$0.0123 - 12.4s - 1,000 in / 40,000 out");
  });
});
