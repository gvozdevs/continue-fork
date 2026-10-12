import { IDE, Tool } from "../..";
import { validateMultiEdit } from "../../edit/searchAndReplace/multiEditValidation";
import { executeMultiFindAndReplace } from "../../edit/searchAndReplace/performReplace";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import {
  FILE_WRITE_ARGS_REQUIRED,
  multiEditHasEdits,
  PreparedFileCreate,
  PreparedFileEdit,
  requireFilepath,
  resolveExistingFile,
  resolveNewFile,
  throwIfEditArgsTooLarge,
} from "../fileWritePlan";
export interface EditOperation {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface MultiEditArgs {
  filepath: string;
  edits: EditOperation[];
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

export function schemaArgsForMultiEdit(
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(args.edits)) {
    return args;
  }
  return {
    ...args,
    edits: args.edits.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return item;
      }
      const record = item as Record<string, unknown>;
      return {
        ...record,
        old_string: pickEditText(record, ["old_string", "old_text"]),
        new_string: pickEditText(record, ["new_string", "new_text"]),
      };
    }),
  };
}

export async function prepareMultiEdit(
  args: Record<string, unknown>,
  ide: IDE,
): Promise<PreparedFileEdit | PreparedFileCreate> {
  const filepath = requireFilepath(args.filepath);
  throwIfEditArgsTooLarge(args);
  if (!multiEditHasEdits(args)) {
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

  const { edits } = validateMultiEdit(schemaArgsForMultiEdit(args));
  const fileUri = await resolveExistingFile(filepath, ide);
  const editingFileContents = await ide.readFile(fileUri);
  return {
    creating: false,
    fileUri,
    editingFileContents,
    newFileContents: executeMultiFindAndReplace(editingFileContents, edits),
    edits,
  };
}

export const multiEditTool: Tool = {
  type: "function",
  displayTitle: "Multi Edit",
  wouldLikeTo: "write {{{ filepath }}}",
  isCurrently: "writing {{{ filepath }}}",
  hasAlready: "wrote {{{ filepath }}}",
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  isInstant: false,
  function: {
    name: BuiltInToolNames.MultiEdit,
    description: `Create a file that does not exist, or make one or more exact replacements in a file that exists.

To create a missing file, pass filepath and contents. Do not pass edits.
To change an existing file, pass filepath and edits. Read the file first. Do not pass contents.
If the file already exists, contents is rejected. If it does not exist, edits are rejected.
Each old_string, new_string, and contents value must be at most 6000 characters. Split a longer change into several edits.
Do not print the file in the reply. The file text belongs only in this call.

Use this tool to make multiple edits to a single file in one operation. It allows you to perform multiple find-and-replace operations efficiently. 

To make multiple edits to a file, provide the following:
1. filepath: The path to the file to modify, RELATIVE to the project/workspace root (verify the directory path is correct)
2. edits: An array of edit operations to perform, where each edit contains:
   - old_string: The text to replace (must match the old file contents exactly, including all whitespace/indentation)
   - new_string: The edited text to replace the old_string
   - replace_all: Replace all occurrences of old_string. This parameter is optional and defaults to false.

IMPORTANT:
- Files may be modified between tool calls by users, linters, etc, so always make all edits in one tool call where possible. For example, do not only edit imports if there are other changes in the file, as unused imports may be removed by a linter between tool calls.
- All edits are applied in sequence, in the order they are provided
- Each edit operates on the result of the previous edit, so plan your edits carefully to avoid conflicts between sequential operations
- Edits are atomic - all edits must be valid for the operation to succeed - if any edit fails, none will be applied
- This tool is ideal when you need to make several changes to different parts of the same file

CRITICAL REQUIREMENTS:
1. ALWAYS use the ${BuiltInToolNames.ReadFile} tool just before making edits, to understand the file's up-to-date contents and context. The user can also edit the file while you are working with it.
2. Make one ${BuiltInToolNames.MultiEdit} call per response. Other tools, such as ${BuiltInToolNames.ReadFile} or run_terminal_command, can be called in the same response.
3. When making edits:
- Ensure all edits result in idiomatic, correct code
- Do not leave the code in a broken state
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked
- Use replace_all for replacing and renaming all matches for a string across the file. This parameter is useful if you want to rename a variable, for instance

WARNINGS:
- If earlier edits affect the text that later edits are trying to find, files can become mangled
- The tool will fail if edits.old_string doesn't match the file contents exactly (including whitespace)
- The tool will fail if edits.old_string and edits.new_string are the same - they MUST be different`,
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
            "Full text of a new file. Use this only when the file does not exist. Omit it when passing edits.",
        },
        edits: {
          type: "array",
          description:
            "Array of edit operations to perform sequentially on the file",
          items: {
            type: "object",
            required: ["old_string", "new_string"],
            properties: {
              old_string: {
                type: "string",
                description:
                  "The text to replace (exact match including whitespace/indentation). old_text is accepted as an alias.",
              },
              old_text: {
                type: "string",
                description: "Alias for old_string.",
              },
              new_string: {
                type: "string",
                description:
                  "The text to replace it with. MUST be different than old_string. new_text is accepted as an alias.",
              },
              new_text: {
                type: "string",
                description: "Alias for new_string.",
              },
              replace_all: {
                type: "boolean",
                description:
                  "Replace all occurrences of old_string (default false) in the file",
              },
            },
          },
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To make multiple edits to a single file, use the ${BuiltInToolNames.MultiEdit} tool with a filepath (relative to the root of the workspace) and an array of edit operations.

  For example, you could respond with:`,
    exampleArgs: [
      ["filepath", "path/to/file.ts"],
      [
        "edits",
        `[
  { "old_string": "const oldVar = 'value'", "new_string": "const newVar = 'updated'" },
  { "old_string": "oldFunction()", "new_string": "newFunction()", "replace_all": true }
]`,
      ],
    ],
  },
  defaultToolPolicy: "allowedWithoutPermission",
  preprocessArgs: async (args, extras) => {
    const prepared = await prepareMultiEdit(args, extras.ide);
    return {
      ...args,
      ...prepared,
    };
  },
};
