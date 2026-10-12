/** One file read returns at most this many tokens, unless the user sets a different limit. */
export const DEFAULT_READ_FILE_MAX_TOKENS = 25_000;

/**
 * How many tokens one file read may place in context.
 * A positive user setting wins. The result never exceeds half the model context.
 */
export function readFileTokenLimit(
  model: { contextLength: number } | null | undefined,
  configuredMaxTokens?: number,
): number | undefined {
  if (!model?.contextLength) {
    return undefined;
  }
  const half = model.contextLength / 2;
  const configured =
    configuredMaxTokens !== undefined &&
    Number.isFinite(configuredMaxTokens) &&
    configuredMaxTokens > 0
      ? configuredMaxTokens
      : DEFAULT_READ_FILE_MAX_TOKENS;
  return Math.min(half, configured);
}
