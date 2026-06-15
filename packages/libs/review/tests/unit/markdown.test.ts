import { describe, expect, it } from "vitest";
import type { ReviewMeta, Step, Summary } from "@codethrough/schema";
import { walkthroughToMarkdown } from "../../src/markdown.js";

const meta = (over: Partial<ReviewMeta> = {}): ReviewMeta => ({
  title: "Fix the adder",
  body: "PR body",
  repoOwner: "octo",
  repoName: "demo",
  number: 7,
  baseRef: "main",
  headRef: "fix",
  author: "octocat",
  url: "https://github.com/octo/demo/pull/7",
  ...over,
});

const summary = (over: Partial<Summary> = {}): Summary => ({
  problem: "Subtraction where addition was meant.",
  statusQuo: "The helper returned a - b.",
  solution: "Swap the operator and cover it with a test.",
  keyDecisions: ["Keep the signature", "Add a regression test"],
  ...over,
});

const step = (over: Partial<Step> = {}): Step => ({
  order: 0,
  hunkId: "h0",
  lineRange: null,
  title: "Swap the operator",
  explanation: "The body now returns a + b.",
  ...over,
});

describe("walkthroughToMarkdown", () => {
  it("renders the title, summary sections, and ordered steps", () => {
    const md = walkthroughToMarkdown(meta(), summary(), [
      step(),
      step({
        order: 1,
        hunkId: "h1",
        title: "Add a test",
        explanation: "Covers the new behavior.",
      }),
    ]);

    expect(md).toBe(
      [
        "# Fix the adder",
        "## Problem\n\nSubtraction where addition was meant.",
        "## Status quo\n\nThe helper returned a - b.",
        "## Solution\n\nSwap the operator and cover it with a test.",
        "## Key decisions\n\n- Keep the signature\n- Add a regression test",
        "## Walkthrough\n\n### Step 1: Swap the operator\n\nThe body now returns a + b.\n\n### Step 2: Add a test\n\nCovers the new behavior.",
      ].join("\n\n"),
    );
  });

  it("numbers steps by array position, not the model order field", () => {
    const md = walkthroughToMarkdown(meta(), null, [
      step({ order: 5, title: "First shown" }),
      step({ order: 9, title: "Second shown" }),
    ]);

    expect(md).toContain("### Step 1: First shown");
    expect(md).toContain("### Step 2: Second shown");
  });

  it("omits the summary block entirely when summary is null", () => {
    const md = walkthroughToMarkdown(meta(), null, [step()]);

    expect(md).not.toContain("## Problem");
    expect(md.startsWith("# Fix the adder\n\n## Walkthrough")).toBe(true);
  });

  it("shows a thin-result note when there are no steps", () => {
    const md = walkthroughToMarkdown(meta(), summary(), []);

    expect(md).toContain("## Walkthrough\n\nNo steps were produced for this walkthrough.");
    expect(md).not.toContain("### Step");
  });

  it("falls back to a placeholder when the summary lists no key decisions", () => {
    const md = walkthroughToMarkdown(meta(), summary({ keyDecisions: [] }), []);

    expect(md).toContain("## Key decisions\n\n- (none stated)");
  });

  it("uses the meta title verbatim as the H1", () => {
    const md = walkthroughToMarkdown(meta({ title: "Another change" }), null, []);

    expect(md.startsWith("# Another change")).toBe(true);
  });
});
