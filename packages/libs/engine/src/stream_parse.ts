// Pulls pieces out of the compose response while it is still streaming in. No I/O.
//
// The response is one big JSON object that arrives as text:
//
//   { "summary": { ... }, "steps": [ { ... }, { ... }, ... ] }
//
// We want to hand back the summary the moment it finishes, and each step the
// moment it finishes, instead of waiting for the whole thing. So we read the text
// and report two kinds of events: the summary once, then each finished step.
//
// We count opening and closing brackets to find where each piece ends, skipping
// any brackets that sit inside text and handling backslash escapes. A piece is
// only reported once its closing bracket arrives, so a response that gets cut off
// mid-step never produces a half step.
//
// Feed it text with `push(delta)`; each call returns whatever finished in that
// chunk (often nothing). It allows extra fields and any spacing, and does not
// check the JSON is valid (that happens later); it only finds where pieces end.

/** A finished piece we hand back, with its raw JSON text. */
type ParseEvent = { kind: "summary"; raw: string } | { kind: "step"; raw: string };

// Where we are in the response: looking for the summary, reading the steps list,
// or done with both. Once done, we ignore anything that comes after.
type Phase = "seeking" | "inSteps" | "finished";

// The brackets we react to when we are not inside text.
const OPEN_BRACE = "{";
const CLOSE_BRACE = "}";
const OPEN_BRACKET = "[";
const CLOSE_BRACKET = "]";
const QUOTE = '"';
const BACKSLASH = "\\";

// The two keys we look for in the text.
const SUMMARY_KEY = '"summary"';
const STEPS_KEY = '"steps"';

/**
 * What the scanner remembers as it goes. `buffer` is all the text so far (we cut
 * the pieces we return out of it). `inString`/`escaped` track whether we are
 * inside text so brackets there are ignored. `depth` is how deep we are inside the
 * piece we are reading; `captureStart` is where that piece began.
 */
interface ScanState {
  buffer: string;
  pos: number;
  phase: Phase;
  inString: boolean;
  escaped: boolean;
  // How deep we are inside the piece being read, counted from its opening bracket.
  // -1 means we are not reading a piece right now.
  depth: number;
  captureStart: number;
}

/** Create the scanner's initial state. */
const initialState = (): ScanState => ({
  buffer: "",
  pos: 0,
  phase: "seeking",
  inString: false,
  escaped: false,
  depth: -1,
  captureStart: -1,
});

/**
 * Handle one character of text. Returns true if the character was part of a text
 * value (so the caller should not treat it as a bracket). A backslash makes the
 * next character literal, and a quote ends the text.
 */
const consumeStringChar = (state: ScanState, ch: string): boolean => {
  if (!state.inString) {
    if (ch === QUOTE) {
      state.inString = true;
      return true;
    }
    return false;
  }
  if (state.escaped) {
    state.escaped = false;
    return true;
  }
  if (ch === BACKSLASH) {
    state.escaped = true;
    return true;
  }
  if (ch === QUOTE) {
    state.inString = false;
  }
  return true;
};

/**
 * Count one bracket while reading a piece. The opening bracket is counted too, so
 * the matching close brings the count back to 0 and ends the piece. Returns the
 * piece's raw JSON (including the closing bracket) when it just ended, else null.
 */
const trackCapture = (state: ScanState, ch: string): string | null => {
  if (ch === OPEN_BRACE || ch === OPEN_BRACKET) {
    state.depth += 1;
    return null;
  }
  if (ch === CLOSE_BRACE || ch === CLOSE_BRACKET) {
    state.depth -= 1;
    if (state.depth === 0) {
      const raw = state.buffer.slice(state.captureStart, state.pos + 1);
      state.depth = -1;
      state.captureStart = -1;
      return raw;
    }
  }
  return null;
};

/** Start reading a piece at the current position (its opening bracket). */
const beginCapture = (state: ScanState): void => {
  state.captureStart = state.pos;
  state.depth = 0;
};

/**
 * Which key came last before this position, or null if neither has appeared. Tells
 * us whether an opening bracket belongs to the summary or the steps list (a key and
 * its bracket can be separated by a colon and spaces).
 */
const nearestKey = (state: ScanState): "summary" | "steps" | null => {
  const summaryAt = state.buffer.lastIndexOf(SUMMARY_KEY, state.pos);
  const stepsAt = state.buffer.lastIndexOf(STEPS_KEY, state.pos);
  if (summaryAt === -1 && stepsAt === -1) {
    return null;
  }
  return summaryAt > stepsAt ? "summary" : "steps";
};

/**
 * While still looking and not yet reading a piece: a summary `{` starts reading the
 * summary; a steps `[` moves us into the steps list. Returns true if we just started
 * reading the summary.
 */
const handleSeekingStart = (state: ScanState, ch: string): boolean => {
  const key = nearestKey(state);
  if (ch === OPEN_BRACE && key === "summary") {
    beginCapture(state);
    return true;
  }
  if (ch === OPEN_BRACKET && key === "steps") {
    state.phase = "inSteps";
  }
  return false;
};

/**
 * One character while still looking for the summary or steps. If we are reading the
 * summary, count its brackets and report it when it ends; otherwise look for the
 * summary `{` or the steps `[`.
 */
const stepSeeking = (state: ScanState, ch: string, out: ParseEvent[]): void => {
  if (state.depth < 0 && !handleSeekingStart(state, ch)) {
    return;
  }
  const raw = trackCapture(state, ch);
  if (raw !== null) {
    out.push({ kind: "summary", raw });
  }
};

/**
 * One character inside the steps list. If we are reading a step, count its brackets
 * and report it when it ends; otherwise a `{` starts the next step and a `]` ends
 * the list.
 */
const stepInSteps = (state: ScanState, ch: string, out: ParseEvent[]): void => {
  if (state.depth < 0) {
    if (ch === CLOSE_BRACKET) {
      state.phase = "finished";
      return;
    }
    if (ch !== OPEN_BRACE) {
      return;
    }
    beginCapture(state);
  }
  const raw = trackCapture(state, ch);
  if (raw !== null) {
    out.push({ kind: "step", raw });
  }
};

/**
 * Process one character, adding any finished piece to `out`. Text is handled first
 * (so brackets inside text are ignored), then we react to brackets based on where we
 * are. The loop stops once the steps list closes, so we only ever get here while
 * looking or while inside the steps list.
 */
const stepChar = (state: ScanState, ch: string, out: ParseEvent[]): void => {
  if (consumeStringChar(state, ch)) {
    return;
  }
  if (state.phase === "seeking") {
    stepSeeking(state, ch, out);
    return;
  }
  stepInSteps(state, ch, out);
};

/**
 * Reads the response a chunk at a time. Feed it text with `push`; each call returns
 * the pieces (summary, then steps) that finished in that chunk. No I/O; all state
 * lives in the closure.
 */
interface StreamExtractor {
  push: (delta: string) => ParseEvent[];
}

/** Make a fresh reader for the compose response. */
const createExtractor = (): StreamExtractor => {
  const state = initialState();
  return {
    push: (delta: string): ParseEvent[] => {
      const out: ParseEvent[] = [];
      state.buffer += delta;
      // Read only the newly added characters. `pos` is the index into the whole
      // buffer, so the pieces we cut out stay correct across chunks.
      const end = state.buffer.length;
      for (; state.pos < end; state.pos += 1) {
        if (state.phase === "finished") {
          break;
        }
        stepChar(state, state.buffer[state.pos] as string, out);
      }
      // Leave `pos` at the end so the next push picks up correctly, even if we
      // stopped early because we are done.
      state.pos = end;
      return out;
    },
  };
};

export { createExtractor };
export type { ParseEvent, StreamExtractor };
