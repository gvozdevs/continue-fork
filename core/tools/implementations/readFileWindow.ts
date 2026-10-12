import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { getNumberArg } from "../parseArgs";

export type LineSlice = {
  lines: string[];
  startLine: number;
  endLine: number;
  totalLines: number;
  entireFile: boolean;
  pastEnd: boolean;
};

export function optionalLine(
  args: Record<string, unknown>,
  ...names: string[]
): number | undefined {
  for (const name of names) {
    const value = args?.[name];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    return getNumberArg(args, name);
  }
  return undefined;
}

export function splitFileLines(content: string): string[] {
  if (content === "") {
    return [];
  }
  return content.split(/\r?\n/);
}

export function sliceFileLines(
  content: string,
  startLine?: number,
  endLine?: number,
): LineSlice {
  if (startLine !== undefined && startLine < 1) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      "start_line must be 1 or greater.",
    );
  }
  if (endLine !== undefined && endLine < 1) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      "end_line must be 1 or greater.",
    );
  }

  const lines = splitFileLines(content);
  const totalLines = lines.length;
  const start = startLine ?? 1;
  const end = endLine ?? (totalLines === 0 ? 0 : totalLines);

  if (endLine !== undefined && end < start) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      `end_line (${end}) must be greater than or equal to start_line (${start}).`,
    );
  }

  if (totalLines === 0 || start > totalLines) {
    return {
      lines: [],
      startLine: start,
      endLine: end,
      totalLines,
      entireFile: false,
      pastEnd: start > totalLines,
    };
  }

  const clippedEnd = Math.min(end, totalLines);
  return {
    lines: lines.slice(start - 1, clippedEnd),
    startLine: start,
    endLine: clippedEnd,
    totalLines,
    entireFile: start === 1 && clippedEnd === totalLines,
    pastEnd: false,
  };
}

/**
 * Keep a prefix of lines whose token count is within limit.
 * One over-long line is shortened by characters so the read still returns text.
 */
export async function limitLines(
  lines: string[],
  tokenLimit: number | undefined,
  countTokens: (text: string) => Promise<number>,
): Promise<{ lines: string[]; truncated: boolean }> {
  if (lines.length === 0 || tokenLimit === undefined || tokenLimit <= 0) {
    return { lines, truncated: false };
  }

  const full = lines.join("\n");
  const tokens = await countTokens(full);
  if (tokens <= tokenLimit) {
    return { lines, truncated: false };
  }

  let take = Math.max(1, Math.floor(lines.length * (tokenLimit / tokens) * 0.9));
  let slice = lines.slice(0, take);
  let sliceTokens = await countTokens(slice.join("\n"));
  for (let guard = 0; sliceTokens > tokenLimit && take > 1 && guard < 8; guard++) {
    take = Math.max(1, Math.floor(take * (tokenLimit / sliceTokens) * 0.9));
    slice = lines.slice(0, take);
    sliceTokens = await countTokens(slice.join("\n"));
  }

  if (sliceTokens > tokenLimit) {
    const text = slice[0] ?? "";
    const chars = Math.max(
      200,
      Math.floor(text.length * (tokenLimit / sliceTokens) * 0.9),
    );
    return { lines: [text.slice(0, chars)], truncated: true };
  }

  return { lines: slice, truncated: true };
}

export function readWindowNotice(
  displayPath: string,
  startLine: number,
  endLine: number,
  totalLines: number,
  truncated: boolean,
): string {
  const range = `[read_file] ${displayPath}: lines ${startLine}-${endLine} of ${totalLines}.`;
  if (!truncated) {
    return range;
  }
  const remaining = totalLines - endLine;
  if (remaining <= 0) {
    return `${range} The rest of the file is empty.`;
  }
  const windowSize = Math.max(1, endLine - startLine + 1);
  const nextStart = endLine + 1;
  const nextEnd = Math.min(totalLines, endLine + windowSize);
  return `${range} ${remaining} more lines follow. Prefer grep_search with path "${displayPath}" to find a heading or name in the rest of the file. To read the next window instead, call read_file with files: [{ "path": "${displayPath}", "start_line": ${nextStart}, "end_line": ${nextEnd} }]. Make the call now; do not describe it.`;
}
