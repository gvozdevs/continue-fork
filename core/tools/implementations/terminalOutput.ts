export const TERMINAL_OUTPUT_CHAR_LIMIT = 20_000;

/**
 * Keep the last part of a long terminal output so the result fits the context.
 * The cut is made at a line boundary and the notice says how much was removed.
 */
export function tailTerminalOutput(
  output: string,
  limit: number = TERMINAL_OUTPUT_CHAR_LIMIT,
): string {
  if (output.length <= limit) {
    return output;
  }
  let tail = output.slice(output.length - limit);
  const firstBreak = tail.indexOf("\n");
  if (firstBreak !== -1 && firstBreak < tail.length - 1) {
    tail = tail.slice(firstBreak + 1);
  }
  const removedChars = output.length - tail.length;
  const removedLines = output.slice(0, output.length - tail.length).split("\n").length - 1;
  return `[Terminal output was cut: the first ${removedLines} lines (${removedChars} characters) were removed, the last part follows. Rerun with a filter or a line limit to see a specific section.]\n${tail}`;
}
