// Tests for the streaming JSON reader. It must return the summary once and each step
// once as they finish, no matter how the text is split, ignore brackets inside text,
// and never return a half step. These cases cover: summary then steps, a step split
// across chunks, text holding { } ] and escaped quotes, and a cut-off ending.

import { describe, expect, it } from "vitest";

import { createExtractor, type ParseEvent } from "../../src/stream_parse.js";

// Feed the whole text in one push and return the events.
const extractAll = (text: string): ParseEvent[] => createExtractor().push(text);

// Feed the text one character at a time (the worst-case split) and collect every
// event.
const extractByChar = (text: string): ParseEvent[] => {
  const extractor = createExtractor();
  const out: ParseEvent[] = [];
  for (const ch of text) {
    out.push(...extractor.push(ch));
  }
  return out;
};

// Feed the text split at the given positions and collect every event.
const extractInChunks = (text: string, splits: number[]): ParseEvent[] => {
  const extractor = createExtractor();
  const out: ParseEvent[] = [];
  const bounds = [0, ...splits, text.length];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    out.push(...extractor.push(text.slice(bounds[i], bounds[i + 1])));
  }
  return out;
};

const WALKTHROUGH = JSON.stringify({
  summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: ["d1", "d2"] },
  steps: [
    { order: 1, hunkId: "h0", lineRange: null, title: "first", explanation: "e1" },
    { order: 2, hunkId: "h1", lineRange: [3, 5], title: "second", explanation: "e2" },
  ],
});

describe("createExtractor: summary then steps", () => {
  it("surfaces the summary first, then each step in order", () => {
    const events = extractAll(WALKTHROUGH);
    expect(events.map((e) => e.kind)).toEqual(["summary", "step", "step"]);
  });

  it("surfaces raw JSON that round-trips through JSON.parse", () => {
    const events = extractAll(WALKTHROUGH);
    const summary = JSON.parse(events[0]!.raw) as { problem: string; keyDecisions: string[] };
    expect(summary.problem).toBe("p");
    expect(summary.keyDecisions).toEqual(["d1", "d2"]);
    const step1 = JSON.parse(events[1]!.raw) as { order: number; title: string };
    expect(step1).toEqual({
      order: 1,
      hunkId: "h0",
      lineRange: null,
      title: "first",
      explanation: "e1",
    });
    const step2 = JSON.parse(events[2]!.raw) as { lineRange: number[] };
    expect(step2.lineRange).toEqual([3, 5]);
  });

  it("yields the same events whether fed whole or one char at a time", () => {
    expect(extractByChar(WALKTHROUGH)).toEqual(extractAll(WALKTHROUGH));
  });
});

describe("createExtractor: a step split across deltas", () => {
  it("emits a step only when its closing brace arrives, never before", () => {
    // Split right in the middle of the second step.
    const mid = WALKTHROUGH.indexOf('"second"');
    const first = extractInChunks(WALKTHROUGH, [mid]);
    expect(first.map((e) => e.kind)).toEqual(["summary", "step", "step"]);

    // Feed up to the second step's opening brace and no further; only the summary
    // and first step are done.
    const extractor = createExtractor();
    const stepTwoOpen = WALKTHROUGH.indexOf('{"order":2');
    const before = extractor.push(WALKTHROUGH.slice(0, stepTwoOpen + 1));
    expect(before.map((e) => e.kind)).toEqual(["summary", "step"]);
    // The rest of the second step finishes it.
    const after = extractor.push(WALKTHROUGH.slice(stepTwoOpen + 1));
    expect(after.map((e) => e.kind)).toEqual(["step"]);
  });

  it("handles a split exactly on the summary's closing brace", () => {
    // The first "}" in the text is the end of the summary.
    const closeAt = WALKTHROUGH.indexOf("}");
    const events = extractInChunks(WALKTHROUGH, [closeAt, closeAt + 1]);
    expect(events.map((e) => e.kind)).toEqual(["summary", "step", "step"]);
  });
});

describe("createExtractor: strings containing structural characters", () => {
  it("ignores braces, brackets, and escaped quotes inside string values", () => {
    const tricky = JSON.stringify({
      summary: {
        problem: 'has } and ] and { and [ and a \\" quote',
        statusQuo: "}{][",
        solution: "ok",
        keyDecisions: ["a } b", "c ] d"],
      },
      steps: [
        { order: 1, hunkId: "h0", lineRange: null, title: "t }", explanation: 'e \\" } ] {' },
      ],
    });
    const whole = extractAll(tricky);
    expect(whole.map((e) => e.kind)).toEqual(["summary", "step"]);
    // The returned pieces are still valid JSON despite the brackets inside text.
    const summary = JSON.parse(whole[0]!.raw) as { problem: string };
    expect(summary.problem).toContain('"');
    const step = JSON.parse(whole[1]!.raw) as { explanation: string };
    expect(step.explanation).toContain("}");
    // Char-by-char must match (the text-tracking has to survive a split).
    expect(extractByChar(tricky)).toEqual(whole);
  });

  it("treats a literal backslash before a non-quote as an escape, not a quote toggle", () => {
    // A path-like value with an escaped backslash then more content.
    const doc = JSON.stringify({
      summary: { problem: "a\\\\b", statusQuo: "s", solution: "sol", keyDecisions: [] },
      steps: [{ order: 1, hunkId: "h0", lineRange: null, title: "t", explanation: "e" }],
    });
    expect(extractByChar(doc).map((e) => e.kind)).toEqual(["summary", "step"]);
  });

  it('locks phase-gating when a summary value literally contains the tokens "steps"/"summary"', () => {
    // The summary text contains the quoted words "steps" and "summary", which look
    // just like the real keys. Since the reader skips brackets and quotes inside
    // text, those must not be mistaken for the keys: the summary still comes out once
    // and the real steps list is still found after it.
    const doc = JSON.stringify({
      summary: {
        problem: 'It mentions "steps" and "summary" inside this very string.',
        statusQuo: 'Another "steps" reference and a "summary" word here too.',
        solution: "sol",
        keyDecisions: ['a decision naming "steps"'],
      },
      steps: [
        { order: 1, hunkId: "h0", lineRange: null, title: 'about "summary"', explanation: "e1" },
        { order: 2, hunkId: "h1", lineRange: null, title: 'about "steps"', explanation: "e2" },
      ],
    });
    const whole = extractAll(doc);
    expect(whole.map((e) => e.kind)).toEqual(["summary", "step", "step"]);
    // The surfaced raw slices still parse and carry the literal token text.
    const summary = JSON.parse(whole[0]!.raw) as { problem: string };
    expect(summary.problem).toContain('"steps"');
    expect(summary.problem).toContain('"summary"');
    const step2 = JSON.parse(whole[2]!.raw) as { title: string };
    expect(step2.title).toBe('about "steps"');
    // Char-by-char must match (the key-tracking has to survive a split).
    expect(extractByChar(doc)).toEqual(whole);
  });
});

describe("createExtractor: truncated / never-closed tail (max_tokens)", () => {
  it("does NOT surface a step whose object was cut off mid-stream", () => {
    // Cut inside the second step, after the first one finished.
    const cut = WALKTHROUGH.indexOf('"second"');
    const truncated = WALKTHROUGH.slice(0, cut);
    const events = extractAll(truncated);
    // Summary and the finished first step only; the half second step is held back.
    expect(events.map((e) => e.kind)).toEqual(["summary", "step"]);
  });

  it("surfaces the summary but no steps when cut inside the first step", () => {
    const cut = WALKTHROUGH.indexOf('"first"');
    const events = extractAll(WALKTHROUGH.slice(0, cut));
    expect(events.map((e) => e.kind)).toEqual(["summary"]);
  });

  it("surfaces nothing when cut inside the summary object", () => {
    const cut = WALKTHROUGH.indexOf('"statusQuo"');
    expect(extractAll(WALKTHROUGH.slice(0, cut))).toEqual([]);
  });
});

describe("createExtractor: edge shapes", () => {
  it("handles an empty steps array (summary only)", () => {
    const doc = JSON.stringify({
      summary: { problem: "p", statusQuo: "s", solution: "sol", keyDecisions: [] },
      steps: [],
    });
    expect(extractAll(doc).map((e) => e.kind)).toEqual(["summary"]);
  });

  it("tolerates whitespace and newlines between tokens", () => {
    const pretty = JSON.stringify(JSON.parse(WALKTHROUGH), null, 2);
    expect(extractAll(pretty).map((e) => e.kind)).toEqual(["summary", "step", "step"]);
    expect(extractByChar(pretty)).toEqual(extractAll(pretty));
  });

  it("ignores trailing content after the steps array closes", () => {
    // An extra field after the steps list must not produce more events.
    const doc =
      '{"summary":{"problem":"p","statusQuo":"s","solution":"sol","keyDecisions":[]},' +
      '"steps":[{"order":1,"hunkId":"h0","lineRange":null,"title":"t","explanation":"e"}],' +
      '"extra":{"ignored":true}}';
    expect(extractAll(doc).map((e) => e.kind)).toEqual(["summary", "step"]);
  });

  it("returns no events for an empty push", () => {
    expect(extractAll("")).toEqual([]);
  });
});
