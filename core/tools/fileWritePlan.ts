import { IDE } from "..";
import { throwIfFileIsSecurityConcern } from "../indexing/ignore";
import { ContinueError, ContinueErrorReason } from "../util/errors";
import {
  inferResolvedUriFromRelativePath,
  resolveRelativePathInDir,
} from "../util/ideUtils";
import { getCleanUriPath } from "../util/uri";

export interface PreparedFileEdit {
  creating: false;
  fileUri: string;
  editingFileContents: string;
  newFileContents: string;
  edits: { old_string: string; new_string: string; replace_all?: boolean }[];
}

export interface PreparedFileCreate {
  creating: true;
  fileUri: string;
  newFileContents: string;
}

export const FILE_WRITE_ARGS_REQUIRED =
  "Pass contents to create a file that does not exist, or replacements to change a file that exists.";

/** Maximum characters in one old_string, new_string, or contents value. */
export const EDIT_ARG_CHAR_LIMIT = 6_000;

export function throwIfEditTextTooLarge(field: string, value: unknown): void {
  if (typeof value !== "string" || value.length <= EDIT_ARG_CHAR_LIMIT) {
    return;
  }
  throw new ContinueError(
    ContinueErrorReason.InvalidToolArgs,
    `Editor input too large: ${field} was ${value.length} characters, exceeding the limit of ${EDIT_ARG_CHAR_LIMIT}. Split the edit into smaller tool calls.`,
  );
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (typeof record[key] === "string") {
      return record[key];
    }
  }
  return undefined;
}

export function throwIfEditArgsTooLarge(args: Record<string, unknown>): void {
  throwIfEditTextTooLarge("contents", args.contents);
  throwIfEditTextTooLarge(
    "old_string",
    firstString(args, ["old_string", "old_text"]),
  );
  throwIfEditTextTooLarge(
    "new_string",
    firstString(args, ["new_string", "new_text"]),
  );
  for (const list of [args.replacements, args.edits]) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const record = item as Record<string, unknown>;
      throwIfEditTextTooLarge(
        "old_string",
        firstString(record, ["old_string", "old_text"]),
      );
      throwIfEditTextTooLarge(
        "new_string",
        firstString(record, ["new_string", "new_text"]),
      );
    }
  }
}

export function requireFilepath(filepath: unknown): string {
  if (!filepath || typeof filepath !== "string") {
    throw new ContinueError(
      ContinueErrorReason.FindAndReplaceMissingFilepath,
      "filepath (string) is required",
    );
  }
  return filepath;
}

export function singleFindHasEdits(args: Record<string, unknown>): boolean {
  if (Array.isArray(args.replacements)) {
    return args.replacements.length > 0;
  }
  return "old_string" in args || "new_string" in args;
}

export function multiEditHasEdits(args: Record<string, unknown>): boolean {
  return Array.isArray(args.edits) && args.edits.length > 0;
}

export async function resolveExistingFile(
  filepath: string,
  ide: IDE,
): Promise<string> {
  const resolved = await resolveRelativePathInDir(filepath, ide);
  if (!resolved) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `File ${filepath} does not exist. Pass contents to create it.`,
    );
  }
  return resolved;
}

export async function resolveNewFile(
  filepath: string,
  ide: IDE,
): Promise<string> {
  const uri = await inferResolvedUriFromRelativePath(filepath, ide);
  throwIfFileIsSecurityConcern(getCleanUriPath(uri));
  if (await ide.fileExists(uri)) {
    throw new ContinueError(
      ContinueErrorReason.FileAlreadyExists,
      `File ${filepath} already exists. To change it, pass replacements or edits and set old_string to the exact text in the file that new_string should replace. Read the file first if needed. Do not resend this call with contents.`,
    );
  }
  return uri;
}
