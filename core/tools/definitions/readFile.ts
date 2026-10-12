import { ToolPolicy } from "@continuedev/terminal-security";
import { Tool } from "../..";
import {
  ResolvedPath,
  isTrustedFileAccess,
  resolveInputPath,
} from "../../util/pathResolver";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { evaluateFileAccessPolicy } from "../policies/fileAccess";

export type ReadFileTarget = {
  path: string;
  start_line?: number;
  end_line?: number;
};

export function filePathsFromArg(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === "string" && item.trim() !== "",
    );
  }
  return [];
}

function optionalBound(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readTargetsFromArgs(
  args: Record<string, unknown>,
): ReadFileTarget[] {
  const files = args.files;
  if (Array.isArray(files) && files.length > 0) {
    const targets: ReadFileTarget[] = [];
    for (const item of files) {
      if (typeof item === "string" && item.trim()) {
        targets.push({ path: item.trim() });
        continue;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const path =
        typeof record.path === "string"
          ? record.path
          : typeof record.filepath === "string"
            ? record.filepath
            : "";
      if (!path.trim()) {
        continue;
      }
      targets.push({
        path: path.trim(),
        start_line: optionalBound(record.start_line ?? record.startLine),
        end_line: optionalBound(record.end_line ?? record.endLine),
      });
    }
    if (targets.length > 0) {
      return targets;
    }
  }

  const paths = filePathsFromArg(args.filepath);
  const start_line = optionalBound(args.start_line ?? args.startLine);
  const end_line = optionalBound(args.end_line ?? args.endLine);
  return paths.map((path) => ({ path, start_line, end_line }));
}

export const readFileTool: Tool = {
  type: "function",
  displayTitle: "Read File",
  wouldLikeTo: "read {{{ filepath }}}",
  isCurrently: "reading {{{ filepath }}}",
  hasAlready: "read {{{ filepath }}}",
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ReadFile,
    description:
      "Read one or more files whose paths are already known. Call it immediately; do not describe the read first. Prefer the files array so each path can have its own start_line and end_line. filepath still works for one path or several paths that share the same range. A long file with no range returns the first window and the total line count. To find a name in the rest of a long file, call grep_search with path set to that file.",
    parameters: {
      type: "object",
      properties: {
        files: {
          type: "array",
          description:
            "Files to read in this one call. Each entry can set its own 1-based inclusive line range.",
          items: {
            type: "object",
            required: ["path"],
            properties: {
              path: {
                type: "string",
                description:
                  "Path relative to the workspace root, absolute, a tilde path (~/...), or a file:// URI.",
              },
              start_line: {
                anyOf: [
                  { type: "integer" },
                  { type: "string" },
                  { type: "null" },
                ],
                description: "Optional 1-based first line for this file.",
              },
              end_line: {
                anyOf: [
                  { type: "integer" },
                  { type: "string" },
                  { type: "null" },
                ],
                description:
                  "Optional 1-based last line, inclusive, for this file.",
              },
            },
          },
        },
        filepath: {
          anyOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
          description:
            "A path, or an array of paths, that share the same start_line/end_line. Prefer files when ranges differ.",
        },
        start_line: {
          anyOf: [{ type: "integer" }, { type: "string" }, { type: "null" }],
          description:
            "Optional 1-based first line. Applies to every filepath in this call. Omit to start at line 1.",
        },
        end_line: {
          anyOf: [{ type: "integer" }, { type: "string" }, { type: "null" }],
          description:
            "Optional 1-based last line, inclusive. Applies to every filepath in this call.",
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To read a file with a known filepath, use the ${BuiltInToolNames.ReadFile} tool. For example, to read a file located at 'path/to/file.txt', you would respond with this:`,
    exampleArgs: [["filepath", "path/to/the_file.txt"]],
  },
  defaultToolPolicy: "allowedWithoutPermission",
  toolCallIcon: "DocumentIcon",
  preprocessArgs: async (args, { ide }) => {
    const targets = readTargetsFromArgs(args);
    const resolvedPaths = await Promise.all(
      targets.map((target) => resolveInputPath(ide, target.path)),
    );

    return {
      resolvedPaths,
    };
  },
  evaluateToolCallPolicy: (
    basePolicy: ToolPolicy,
    _: Record<string, unknown>,
    processedArgs?: Record<string, unknown>,
  ): ToolPolicy => {
    const resolvedPaths = processedArgs?.resolvedPaths as
      | Array<ResolvedPath | null | undefined>
      | undefined;
    if (!resolvedPaths?.length) return basePolicy;

    const trusted = resolvedPaths.every(
      (resolvedPath) => resolvedPath && isTrustedFileAccess(resolvedPath),
    );
    return evaluateFileAccessPolicy(basePolicy, trusted);
  },
};
