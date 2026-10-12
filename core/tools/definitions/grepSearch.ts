import { ToolPolicy } from "@continuedev/terminal-security";
import { Tool } from "../..";
import {
  ResolvedPath,
  isTrustedFileAccess,
  resolveInputPath,
} from "../../util/pathResolver";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { evaluateFileAccessPolicy } from "../policies/fileAccess";

export const grepSearchTool: Tool = {
  type: "function",
  displayTitle: "Grep Search",
  wouldLikeTo: 'search for "{{{ query }}}"',
  isCurrently: 'searching for "{{{ query }}}"',
  hasAlready: 'searched for "{{{ query }}}"',
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.GrepSearch,
    description:
      "Find a line or an unknown file by regex. If the file path is already known and you need its contents, call read_file instead. Set path only to search inside one file for a line number; the result includes 1-based lines. Omit path to search the workspace. Pass queries as an array to run several searches in one call. A Cyrillic query is matched as Unicode text. Workspace search skips many build, cache, and secrets paths. Output may be truncated, so use a short query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The regex pattern to search for. A plain Cyrillic or Latin phrase is fine. Use alternation (e.g., 'word1|word2') to find several words in one search.",
        },
        queries: {
          type: "array",
          items: { type: "string" },
          description:
            "Several regex patterns to search in this one call. Results are returned in order.",
        },
        path: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description:
            "Optional path of one file to search. Relative to the workspace root, absolute, a tilde path (~/...), or a file:// URI. Omit to search the whole workspace.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  preprocessArgs: async (args, { ide }) => {
    const filePath = typeof args.path === "string" ? args.path.trim() : "";
    if (!filePath) {
      return {};
    }
    const resolvedPath = await resolveInputPath(ide, filePath);
    return { resolvedPath };
  },
  evaluateToolCallPolicy: (
    basePolicy: ToolPolicy,
    _: Record<string, unknown>,
    processedArgs?: Record<string, unknown>,
  ): ToolPolicy => {
    const resolvedPath = processedArgs?.resolvedPath as
      | ResolvedPath
      | null
      | undefined;
    if (!resolvedPath) return basePolicy;
    return evaluateFileAccessPolicy(
      basePolicy,
      isTrustedFileAccess(resolvedPath),
    );
  },
  systemMessageDescription: {
    prefix: `To perform a grep search within the project, call the ${BuiltInToolNames.GrepSearch} tool with the query pattern to match. For example:`,
    exampleArgs: [["query", ".*main_services.*"]],
  },
  toolCallIcon: "MagnifyingGlassIcon",
};
