import type { ContextItem, FileType, IDE } from "../index.js";
import { isSecurityConcern } from "../indexing/ignore";
import { resolveInputPath } from "../util/pathResolver";
import {
  getUriDescription,
  getUriFileExtension,
  getUriPathBasename,
  joinPathsToUri,
} from "../util/uri";

export const DEFAULT_MENTION_CHAR_BUDGET = 400_000;

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "pdf",
  "zip",
  "gz",
  "tar",
  "7z",
  "rar",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "wasm",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "mp3",
  "mp4",
  "webm",
  "ogg",
  "wav",
  "class",
  "o",
  "a",
  "pyc",
  "pyo",
]);

export type ExpandMentionOptions = {
  charBudget?: number;
};

async function uriIsDirectory(ide: IDE, uri: string): Promise<boolean> {
  try {
    await ide.listDir(uri);
    return true;
  } catch {
    return false;
  }
}

function isProbablyBinary(uri: string, content: string): boolean {
  const ext = getUriFileExtension(uri);
  if (BINARY_EXTENSIONS.has(ext)) {
    return true;
  }
  return content.includes("\0");
}

function displayPathFor(
  uri: string,
  workspaceDirs: string[],
): { relative: string; baseName: string; last2Parts: string } {
  const description = getUriDescription(uri, workspaceDirs);
  return {
    relative: description.relativePathOrBasename || description.baseName,
    baseName: description.baseName,
    last2Parts: description.last2Parts,
  };
}

async function readTextFile(
  ide: IDE,
  uri: string,
): Promise<string | undefined> {
  try {
    const content = await ide.readFile(uri, true);
    if (isProbablyBinary(uri, content)) {
      return undefined;
    }
    return content;
  } catch {
    return undefined;
  }
}

type FolderEntry = { name: string; uri: string; isDirectory: boolean };

async function listFolderEntries(
  ide: IDE,
  dirUri: string,
): Promise<FolderEntry[]> {
  const listed = await ide.listDir(dirUri);
  const entries: FolderEntry[] = listed.map(([name, type]) => ({
    name,
    uri: joinPathsToUri(dirUri, name),
    isDirectory: type === (2 as FileType.Directory),
  }));
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
  return entries;
}

function formatTree(entries: FolderEntry[]): string {
  return entries
    .map((entry, index) => {
      const last = index === entries.length - 1;
      const prefix = last ? "└── " : "├── ";
      return `${prefix}${entry.name}${entry.isDirectory ? "/" : ""}`;
    })
    .join("\n");
}

function appendWithinBudget(
  parts: string[],
  chunk: string,
  remaining: { chars: number },
): boolean {
  if (chunk.length <= remaining.chars) {
    parts.push(chunk);
    remaining.chars -= chunk.length;
    return true;
  }
  if (remaining.chars < 80) {
    return false;
  }
  parts.push(
    `${chunk.slice(0, remaining.chars - 40)}\n...[truncated to mention budget]`,
  );
  remaining.chars = 0;
  return false;
}

async function expandFilesInFolder(
  ide: IDE,
  entries: FolderEntry[],
  workspaceDirs: string[],
  remaining: { chars: number },
): Promise<string[]> {
  const blocks: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory || remaining.chars <= 0) {
      continue;
    }
    if (isSecurityConcern(entry.uri) || isSecurityConcern(entry.name)) {
      continue;
    }
    const content = await readTextFile(ide, entry.uri);
    if (content === undefined) {
      continue;
    }
    const relative = displayPathFor(entry.uri, workspaceDirs).relative;
    const block = `<file_content path="${relative}">\n${content}\n</file_content>`;
    if (!appendWithinBudget(blocks, block, remaining)) {
      break;
    }
  }
  return blocks;
}

async function formatFolderContent(
  ide: IDE,
  dirUri: string,
  workspaceDirs: string[],
  charBudget: number,
): Promise<string> {
  const remaining = { chars: charBudget };
  const relative = displayPathFor(dirUri, workspaceDirs).relative;
  const entries = await listFolderEntries(ide, dirUri);
  const tree = formatTree(entries);
  const parts = [`<folder_content path="${relative}">`, tree, ""];
  remaining.chars -= parts.join("\n").length;

  const files = entries.filter((entry) => !entry.isDirectory);
  const dirs = entries.filter((entry) => entry.isDirectory);

  const fileBlocks = await expandFilesInFolder(
    ide,
    files,
    workspaceDirs,
    remaining,
  );
  parts.push(...fileBlocks);

  // Generic extra level: if this folder only contains subfolders, expand each
  // one level so nested skill/docs layouts still attach file text.
  if (files.length === 0 && dirs.length > 0 && remaining.chars > 0) {
    for (const dir of dirs) {
      if (remaining.chars <= 0) {
        break;
      }
      let nested: FolderEntry[];
      try {
        nested = await listFolderEntries(ide, dir.uri);
      } catch {
        continue;
      }
      const nestedRelative = displayPathFor(dir.uri, workspaceDirs).relative;
      const nestedTree = `${nestedRelative}/\n${formatTree(nested)}`;
      appendWithinBudget(parts, nestedTree, remaining);
      const nestedFiles = await expandFilesInFolder(
        ide,
        nested,
        workspaceDirs,
        remaining,
      );
      parts.push(...nestedFiles);
    }
  }

  parts.push(`</folder_content>`);
  return parts.join("\n");
}

export async function expandWorkspaceMention(
  ide: IDE,
  query: string,
  options: ExpandMentionOptions = {},
): Promise<ContextItem[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const resolved = await resolveInputPath(ide, trimmed);
  if (!resolved) {
    return [];
  }

  if (
    isSecurityConcern(resolved.uri) ||
    isSecurityConcern(resolved.displayPath)
  ) {
    return [
      {
        name: getUriPathBasename(resolved.uri),
        description: resolved.displayPath,
        content: `Skipped ${resolved.displayPath}: this path is ignored for security.`,
      },
    ];
  }

  const workspaceDirs = await ide.getWorkspaceDirs();
  const charBudget = options.charBudget ?? DEFAULT_MENTION_CHAR_BUDGET;
  const { relative, baseName, last2Parts } = displayPathFor(
    resolved.uri,
    workspaceDirs,
  );

  if (await uriIsDirectory(ide, resolved.uri)) {
    const content = await formatFolderContent(
      ide,
      resolved.uri,
      workspaceDirs,
      charBudget,
    );
    return [
      {
        name: baseName,
        description: last2Parts || relative,
        content,
        uri: { type: "file", value: resolved.uri },
      },
    ];
  }

  if (!(await ide.fileExists(resolved.uri))) {
    return [];
  }

  const content = await readTextFile(ide, resolved.uri);
  if (content === undefined) {
    return [
      {
        name: baseName,
        description: last2Parts || relative,
        content: `(Binary file, unable to display content of ${relative})`,
        uri: { type: "file", value: resolved.uri },
      },
    ];
  }

  return [
    {
      name: baseName,
      description: last2Parts || relative,
      content: `<file_content path="${relative}">\n${content}\n</file_content>`,
      uri: { type: "file", value: resolved.uri },
    },
  ];
}
