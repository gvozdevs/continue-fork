import { IDE, Tool } from "../..";
import { validateSingleEdit } from "../../edit/searchAndReplace/findAndReplaceUtils";
import { executeMultiFindAndReplace } from "../../edit/searchAndReplace/performReplace";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import {
  FILE_WRITE_ARGS_REQUIRED,
  PreparedFileCreate,
  PreparedFileEdit,
  requireFilepath,
  resolveExistingFile,
  resolveNewFile,
  singleFindHasEdits,
  throwIfEditArgsTooLarge,
} from "../fileWritePlan";
import { EditOperation } from "./multiEdit";

export interface SingleFindReplacement {
  old_string: string;
  new_string: string;
}

export interface SingleFindAndReplaceArgs {
  filepath: string;
  replacements: SingleFindReplacement[];
}

export function schemaArgsForSingleFind(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = normalizeFindArgs(args);
  if (Array.isArray(normalized.replacements)) {
    return normalized;
  }
  if (!("old_string" in normalized) && !("new_string" in normalized)) {
    return normalized;
  }
  return {
    ...normalized,
    replacements: [
      {
        old_string: normalized.old_string,
        new_string: normalized.new_string,
      },
    ],
  };
}

function pickEditText(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function normalizeFindArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const old_string = pickEditText(args, ["old_string", "old_text"]);
  const new_string = pickEditText(args, ["new_string", "new_text"]);
  const replacements = Array.isArray(args.replacements)
    ? args.replacements.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return item;
        }
        const record = item as Record<string, unknown>;
        return {
          ...record,
          old_string: pickEditText(record, ["old_string", "old_text"]),
          new_string: pickEditText(record, ["new_string", "new_text"]),
        };
      })
    : args.replacements;
  return {
    ...args,
    ...(old_string !== undefined ? { old_string } : {}),
    ...(new_string !== undefined ? { new_string } : {}),
    ...(replacements !== undefined ? { replacements } : {}),
  };
}

export function editsFromSingleFindArgs(
  args: Record<string, unknown>,
): EditOperation[] {
  args = normalizeFindArgs(args);
  if ("replacements" in args && args.replacements !== undefined) {
    if (!Array.isArray(args.replacements)) {
      throw new ContinueError(
        ContinueErrorReason.MultiEditEditsArrayRequired,
        "replacements must be an array",
      );
    }
    if (args.replacements.length === 0) {
      throw new ContinueError(
        ContinueErrorReason.MultiEditEditsArrayEmpty,
        "replacements must contain at least one edit",
      );
    }
    return args.replacements.map((item, index) => {
      const edit = item as { old_string?: unknown; new_string?: unknown };
      const { oldString, newString } = validateSingleEdit(
        edit?.old_string,
        edit?.new_string,
        undefined,
        index,
      );
      return {
        old_string: oldString,
        new_string: newString,
        replace_all: false,
      };
    });
  }

  if ("old_string" in args || "new_string" in args) {
    const { oldString, newString } = validateSingleEdit(
      args.old_string,
      args.new_string,
      undefined,
    );
    return [
      {
        old_string: oldString,
        new_string: newString,
        replace_all: false,
      },
    ];
  }

  throw new ContinueError(
    ContinueErrorReason.MultiEditEditsArrayRequired,
    FILE_WRITE_ARGS_REQUIRED,
  );
}

export async function prepareSingleFind(
  args: Record<string, unknown>,
  ide: IDE,
): Promise<PreparedFileEdit | PreparedFileCreate> {
  const filepath = requireFilepath(args.filepath);
  throwIfEditArgsTooLarge(args);
  if (!singleFindHasEdits(args)) {
    if (typeof args.contents !== "string") {
      throw new ContinueError(
        ContinueErrorReason.MultiEditEditsArrayRequired,
        FILE_WRITE_ARGS_REQUIRED,
      );
    }
    return {
      creating: true,
      fileUri: await resolveNewFile(filepath, ide),
      newFileContents: args.contents,
    };
  }

  const edits = editsFromSingleFindArgs(args);
  const fileUri = await resolveExistingFile(filepath, ide);
  const editingFileContents = await ide.readFile(fileUri);
  return {
    creating: false,
    fileUri,
    editingFileContents,
    newFileContents: executeMultiFindAndReplace(
      editingFileContents,
      edits,
      false,
    ),
    edits,
  };
}

export const singleFindAndReplaceTool: Tool = {
  type: "function",
  displayTitle: "Find and Replace",
  wouldLikeTo: "write {{{ filepath }}}",
  isCurrently: "writing {{{ filepath }}}",
  hasAlready: "wrote {{{ filepath }}}",
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  isInstant: false,
  function: {
    name: BuiltInToolNames.SingleFindAndReplace,
    description: `Create a file that does not exist, or replace text in a file that exists. Call it as soon as the new text is ready: name the step in the reply and put the text only in this call.

Missing file: pass filepath and contents.
Existing file: read it with ${BuiltInToolNames.ReadFile}, then pass filepath and replacements, each with old_string and new_string. Contents on an existing file and replacements on a missing file are rejected; nothing is overwritten.
Each old_string, new_string, and contents value must be at most 6000 characters. Split a longer change into several replacements.

old_string is the smallest span that occurs once in the file: a few lines around the change, or a function header with its first lines. Copy it from the read result. Differences in indentation and blank lines are tolerated. new_string is the text that takes its place.
To rewrite a long function, either use one replacement whose old_string is the whole function, or several replacements in this one call, each pinned to a few lines. If old_string occurs more than once, add the line before or after it.
Keep emojis out of files unless the user asks for them.`,
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: {
          type: "string",
          description:
            "The path of the file to create or change, relative to the root of the workspace",
        },
        contents: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description:
            "Full text of a new file. Use this only when the file does not exist. Omit it when passing replacements.",
        },
        replacements: {
          anyOf: [
            {
              type: "array",
              items: {
                type: "object",
                properties: {
                  old_string: {
                    type: "string",
                    description:
                      "The span to replace: the smallest text that occurs once in the file, copied from the read result. Indentation and blank-line differences are tolerated. old_text is accepted as an alias.",
                  },
                  old_text: {
                    type: "string",
                    description: "Alias for old_string.",
                  },
                  new_string: {
                    type: "string",
                    description:
                      "The text that takes the place of old_string. It must differ from old_string. new_text is accepted as an alias.",
                  },
                  new_text: {
                    type: "string",
                    description: "Alias for new_string.",
                  },
                },
              },
            },
            { type: "null" },
          ],
          description:
            "Changes to an existing file, applied in order in this one call. One item is enough for one change. Omit this when creating a file with contents.",
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To create a missing file or change an existing one, use the ${BuiltInToolNames.SingleFindAndReplace} tool. Pass contents when the file does not exist. Pass a replacements array when it does.

  For example, you could respond with:`,
    exampleArgs: [
      ["filepath", "path/to/file.ts"],
      [
        "replacements",
        `[{ "old_string": "const oldVariable = 'value'", "new_string": "const newVariable = 'updated'" }]`,
      ],
    ],
  },
  defaultToolPolicy: "allowedWithoutPermission",
  preprocessArgs: async (args, extras) => {
    const prepared = await prepareSingleFind(args, extras.ide);
    return {
      ...args,
      ...prepared,
    };
  },
};
