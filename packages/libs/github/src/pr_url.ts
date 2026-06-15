// Parse a PR reference from user input. No I/O. Accepts a full GitHub pull URL
// (any trailing path or query is ignored) or the owner/repo#number shorthand.
// Anything else returns null so the caller can show a clear error.

// One PR's coordinates. The caller maps `number` to GitHub's pull_number.
interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

// An owner or repo segment: anything but a slash, hash, or space.
const SEGMENT = String.raw`[^/#\s]+`;

// The full URL form, tolerating http and a www. host. Any trailing path or query
// is ignored, and the number must be digits.
const URL_RE = new RegExp(
  String.raw`^https?://(?:www\.)?github\.com/(${SEGMENT})/(${SEGMENT})/pull/(\d+)(?:[/?#].*)?$`,
  "i",
);

// The shorthand form: owner/repo#number, no surrounding space.
const SHORT_RE = new RegExp(String.raw`^(${SEGMENT})/(${SEGMENT})#(\d+)$`);

// Build a PrRef from a match's three groups. The number group is always digits.
const refFromMatch = (match: RegExpExecArray): PrRef => ({
  owner: match[1] as string,
  repo: match[2] as string,
  number: Number.parseInt(match[3] as string, 10),
});

// Parse a PR reference, or null when the input is neither a pull URL nor the
// shorthand.
const parsePrUrl = (input: string): PrRef | null => {
  const trimmed = input.trim();
  const match = URL_RE.exec(trimmed) ?? SHORT_RE.exec(trimmed);
  return match === null ? null : refFromMatch(match);
};

export { parsePrUrl };
export type { PrRef };
