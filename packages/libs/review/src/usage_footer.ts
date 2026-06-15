// Formats the cost and elapsed-time footer. Pure, so it is unit-tested.
import type { WalkthroughUsage } from "./walkthrough_stream.js";

// Four decimals so a cost under a cent still shows a non-zero figure.
const COST_DECIMALS = 4;
// Elapsed is shown to one decimal second.
const ELAPSED_DECIMALS = 1;

/** Format the USD cost like "$0.0123". */
const formatCost = (costUsd: number): string => `$${costUsd.toFixed(COST_DECIMALS)}`;

/** Format the elapsed seconds like "12.4s". */
const formatElapsed = (seconds: number): string => `${seconds.toFixed(ELAPSED_DECIMALS)}s`;

/** Format a token count with thousands separators like "1,000". */
const formatTokens = (tokens: number): string => tokens.toLocaleString("en-US");

/**
 * Build the footer text: cost, elapsed time, then the token split. Before the
 * token counts arrive, show only the elapsed time so the run looks like it is
 * making progress.
 */
const formatUsageFooter = (usage: WalkthroughUsage | null, elapsedSeconds: number): string => {
  const elapsed = formatElapsed(elapsedSeconds);
  if (usage === null) {
    return elapsed;
  }
  const tokens = `${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out`;
  return `${formatCost(usage.costUsd)} - ${elapsed} - ${tokens}`;
};

export { formatCost, formatElapsed, formatTokens, formatUsageFooter };
