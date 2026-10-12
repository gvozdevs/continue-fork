import { BuiltInToolNames } from "./builtIn";
import { readTargetsFromArgs, type ReadFileTarget } from "./definitions/readFile";

/** Each read keeps its head and tail. The middle is marked truncated. */
export const READ_RESULT_MAX_CHARS = 8_000;

export const OUTDATED_FILE_CONTENT =
  "[outdated - see the latest file content]";

const READ_TOOL_NAMES = new Set<string>([
  BuiltInToolNames.ReadFile,
  BuiltInToolNames.ReadFileRange,
]);

const WRITE_TOOL_NAMES = new Set<string>([
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
  BuiltInToolNames.CreateNewFile,
]);

export interface ToolResultCall {
  id: string;
  name: string;
  arguments?: string;
  content: string;
}

export function isReadToolName(name: string | undefined): boolean {
  return !!name && READ_TOOL_NAMES.has(name);
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function locatorKey(target: ReadFileTarget): string {
  const path = normalizePath(target.path);
  if (target.start_line === undefined && target.end_line === undefined) {
    return path;
  }
  return `${path}:${target.start_line ?? 1}-${target.end_line ?? "end"}`;
}

function parseArgs(argsJson: string | undefined): Record<string, unknown> | undefined {
  const trimmed = argsJson?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function writePaths(argsJson: string | undefined): string[] {
  const args = parseArgs(argsJson);
  if (!args) {
    return [];
  }
  const paths: string[] = [];
  for (const key of ["filepath", "path"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      paths.push(normalizePath(value));
    }
  }
  return paths;
}

/**
 * Keep the start and end of a long read. The marker sits in the middle so a
 * later request still has the text instead of a prompt to read the file again.
 */
export function truncateReadMiddle(
  text: string,
  maxChars: number = READ_RESULT_MAX_CHARS,
): string {
  if (text.length <= maxChars) {
    return text;
  }
  const markerFor = (removed: number) =>
    `\n\n...[truncated ${removed} chars]...\n\n`;
  let removed = text.length - maxChars;
  let marker = markerFor(removed);
  let keep = Math.max(0, maxChars - marker.length);
  removed = text.length - keep;
  marker = markerFor(removed);
  keep = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return (
    text.slice(0, head) + marker + (tail > 0 ? text.slice(text.length - tail) : "")
  );
}

function isStaleTarget(target: ReadFileTarget, later: ToolResultCall[]): boolean {
  const key = locatorKey(target);
  const path = normalizePath(target.path);
  for (const call of later) {
    if (isReadToolName(call.name)) {
      const args = parseArgs(call.arguments);
      if (!args) {
        continue;
      }
      for (const other of readTargetsFromArgs(args)) {
        if (locatorKey(other) === key) {
          return true;
        }
      }
    }
    if (WRITE_TOOL_NAMES.has(call.name)) {
      if (writePaths(call.arguments).includes(path)) {
        return true;
      }
    }
  }
  return false;
}

function shapeOneRead(call: ToolResultCall, later: ToolResultCall[]): string {
  const args = parseArgs(call.arguments);
  const targets = args ? readTargetsFromArgs(args) : [];
  if (targets.length > 0 && targets.every((target) => isStaleTarget(target, later))) {
    return OUTDATED_FILE_CONTENT;
  }
  return truncateReadMiddle(call.content);
}

/**
 * Later reads of the same path and line range, and edits of that path,
 * replace the older body with a short outdated notice. Every other read
 * keeps a head and tail.
 */
export function shapedReadContents(calls: ToolResultCall[]): Map<string, string> {
  const shaped = new Map<string, string>();
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    if (!isReadToolName(call.name)) {
      continue;
    }
    const next = shapeOneRead(call, calls.slice(i + 1));
    if (next !== call.content) {
      shaped.set(call.id, next);
    }
  }
  return shaped;
}
