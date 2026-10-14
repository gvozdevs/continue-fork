/**
 * Compact once the request reaches this share of the usable input budget.
 * This is a backstop for the model window. Finished-round compaction is
 * separate and stays off unless that setting is on.
 */
export const AUTO_COMPACT_CONTEXT_RATIO = 0.8;

/**
 * Finished rounds beyond the original task and the recent tail.
 * The task text stays in the request. Summarizing earlier than this
 * spends a model call on every step.
 */
export const AUTO_COMPACT_STALE_TOKENS = 30_000;

/** User-set limit, or the default when the setting is missing or not positive. */
export function staleHistoryTokenLimit(configured?: number): number {
  if (
    typeof configured === "number" &&
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return configured;
  }
  return AUTO_COMPACT_STALE_TOKENS;
}

export function shouldAutoCompactContext(options: {
  contextPercentage?: number;
  didPrune?: boolean;
  notEnoughContext?: boolean;
  staleTokens?: number;
  /** When true, finished rounds can start a summary. Defaults to off. */
  compactStaleHistory?: boolean;
  /** Finished-round token count that starts a summary. Defaults to 30_000. */
  staleTokenLimit?: number;
}): boolean {
  if (options.notEnoughContext || options.didPrune) {
    return true;
  }
  if (options.compactStaleHistory === true) {
    const limit = staleHistoryTokenLimit(options.staleTokenLimit);
    if ((options.staleTokens ?? 0) >= limit) {
      return true;
    }
  }
  return (options.contextPercentage ?? 0) >= AUTO_COMPACT_CONTEXT_RATIO;
}
