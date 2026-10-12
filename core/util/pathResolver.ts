import { IDE } from "..";
import { resolveRelativePathInDir } from "./ideUtils";
import { findUriInDirs } from "./uri";

export interface ResolvedPath {
  uri: string;
  displayPath: string;
  isAbsolute: boolean;
  isWithinWorkspace: boolean;
  isInAllowedDirectory: boolean;
}

const WINDOWS_ABS_PATH = /^[a-zA-Z]:[\\/]/;

function isWindowsRuntime(): boolean {
  return typeof process !== "undefined" && process.platform === "win32";
}

function isWindowsPath(fsPath: string): boolean {
  return WINDOWS_ABS_PATH.test(fsPath) || fsPath.startsWith("\\\\");
}

function useWindowsApi(fsPath: string): boolean {
  return isWindowsPath(fsPath) || isWindowsRuntime();
}

function expandTilde(input: string): string {
  if (!input.startsWith("~")) {
    return input;
  }
  const home =
    (typeof process !== "undefined" &&
      (process.env.HOME || process.env.USERPROFILE)) ||
    "";
  if (!home) {
    return input;
  }
  if (input === "~") {
    return home;
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return home + input.slice(1);
  }
  return input;
}

function fileUrlToFsPath(fileUrl: string): string {
  const url = new URL(fileUrl);
  if (url.protocol !== "file:") {
    throw new TypeError(`Invalid file URL: ${fileUrl}`);
  }
  let pathname = decodeURIComponent(url.pathname);
  if (/^\/[a-zA-Z]:/.test(pathname)) {
    pathname = pathname.slice(1);
  }
  if (isWindowsPath(pathname) || isWindowsRuntime()) {
    return pathname.replace(/\//g, "\\");
  }
  return pathname;
}

function fsPathToFileUrl(fsPath: string): string {
  const windows = isWindowsPath(fsPath) || isWindowsRuntime();
  let normalized = fsPath.replace(/\\/g, "/");
  if (windows && WINDOWS_ABS_PATH.test(fsPath) && !normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  } else if (windows && fsPath.startsWith("\\\\")) {
    const unc = fsPath.replace(/\\/g, "/").replace(/^\/+/, "");
    return `file://${unc
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`;
  }
  const encoded = normalized
    .split("/")
    .map((part, index) =>
      index === 1 && /^[a-zA-Z]:$/.test(part) ? part : encodeURIComponent(part),
    )
    .join("/");
  return `file://${encoded}`;
}

interface PathApi {
  isAbsolute(p: string): boolean;
  normalize(p: string): string;
  resolve(...paths: string[]): string;
  sep: string;
}

function normalizeFsPath(fsPath: string, windows: boolean): string {
  const sep = windows ? "\\" : "/";
  const isUnc = windows && fsPath.startsWith("\\\\");
  let value = windows ? fsPath.replace(/\//g, "\\") : fsPath.replace(/\\/g, "/");

  let root = "";
  if (isUnc) {
    const uncParts = value.split(/[\\/]/).filter(Boolean);
    root = `\\\\${uncParts.slice(0, 2).join("\\")}`;
    value = uncParts.slice(2).join("\\");
    if (uncParts.length >= 2) {
      root += "\\";
    }
  } else if (windows && WINDOWS_ABS_PATH.test(value)) {
    root = value.slice(0, 2) + sep;
    value = value.slice(2).replace(/^[\\/]/, "");
  } else if (value.startsWith("/") || (windows && value.startsWith("\\"))) {
    root = sep;
    value = value.slice(1);
  }

  const parts: string[] = [];
  for (const part of value.split(/[\\/]/)) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return root + parts.join(sep);
}

function createPathApi(windows: boolean): PathApi {
  const sep = windows ? "\\" : "/";
  return {
    sep,
    isAbsolute(p: string) {
      return (
        WINDOWS_ABS_PATH.test(p) ||
        p.startsWith("\\\\") ||
        p.startsWith("/") ||
        (windows && p.startsWith("\\"))
      );
    },
    normalize(p: string) {
      return normalizeFsPath(p, windows);
    },
    resolve(p: string) {
      return normalizeFsPath(p, windows);
    },
  };
}

function pathApiFor(fsPath: string): PathApi {
  return createPathApi(useWindowsApi(fsPath));
}

/**
 * Normalize a user-supplied or resolved filesystem path / file URI for comparison.
 * Relative paths are rejected because their meaning depends on an unknown cwd.
 */
export function normalizeComparableFsPath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  let fsPath: string;
  if (/^file:/i.test(trimmed)) {
    try {
      fsPath = fileUrlToFsPath(trimmed);
    } catch {
      return null;
    }
  } else {
    fsPath = expandTilde(trimmed);
  }

  const pathApi = pathApiFor(fsPath);
  if (!pathApi.isAbsolute(fsPath) && !isWindowsPath(fsPath)) {
    return null;
  }

  const resolved = pathApi.normalize(pathApi.resolve(fsPath));
  if (useWindowsApi(fsPath)) {
    return resolved.toLowerCase();
  }
  return resolved;
}

/**
 * True when target is the allowed directory itself or a file/folder inside it.
 * `c:\test` matches `c:\test\foo` but not `c:\test2`.
 */
export function isPathInsideDirectory(
  targetPath: string,
  directoryPath: string,
): boolean {
  const target = normalizeComparableFsPath(targetPath);
  const directory = normalizeComparableFsPath(directoryPath);
  if (!target || !directory) {
    return false;
  }

  const pathApi = pathApiFor(target);
  if (target === directory) {
    return true;
  }

  const separator = pathApi.sep;
  const prefix = directory.endsWith(separator)
    ? directory
    : directory + separator;
  return target.startsWith(prefix);
}

export function isPathInsideAnyAllowedDirectory(
  targetPath: string,
  allowedDirectories: string[],
): boolean {
  return allowedDirectories.some((directory) =>
    isPathInsideDirectory(targetPath, directory),
  );
}

async function getAllowedDirectories(ide: IDE): Promise<string[]> {
  try {
    if (typeof ide.getIdeSettings !== "function") {
      return [];
    }
    const settings = await ide.getIdeSettings();
    if (!Array.isArray(settings?.allowedDirectories)) {
      return [];
    }
    return settings.allowedDirectories.filter(
      (directory) => typeof directory === "string" && directory.trim() !== "",
    );
  } catch {
    return [];
  }
}

async function checkIsInAllowedDirectory(
  ide: IDE,
  uri: string,
  displayPath: string,
): Promise<boolean> {
  const allowedDirectories = await getAllowedDirectories(ide);
  if (allowedDirectories.length === 0) {
    return false;
  }
  return (
    isPathInsideAnyAllowedDirectory(displayPath, allowedDirectories) ||
    isPathInsideAnyAllowedDirectory(uri, allowedDirectories)
  );
}

/**
 * Checks if a URI is within any of the workspace directories
 * Also verifies the file actually exists, matching the behavior of resolveRelativePathInDir
 */
async function isUriWithinWorkspace(ide: IDE, uri: string): Promise<boolean> {
  const workspaceDirs = await ide.getWorkspaceDirs();
  const { foundInDir } = findUriInDirs(uri, workspaceDirs);

  // Check both: within workspace path AND file exists
  if (foundInDir !== null) {
    return await ide.fileExists(uri);
  }

  return false;
}

export async function resolveInputPath(
  ide: IDE,
  inputPath: string,
): Promise<ResolvedPath | null> {
  const trimmedPath = inputPath.trim();

  // Handle file:// URIs
  if (trimmedPath.startsWith("file://")) {
    const displayPath = fileUrlToFsPath(trimmedPath);
    const isWithinWorkspace = await isUriWithinWorkspace(ide, trimmedPath);
    return {
      uri: trimmedPath,
      displayPath,
      isAbsolute: true,
      isWithinWorkspace,
      isInAllowedDirectory: await checkIsInAllowedDirectory(
        ide,
        trimmedPath,
        displayPath,
      ),
    };
  }

  const expandedPath = expandTilde(trimmedPath);
  const pathApi = pathApiFor(expandedPath);

  const isAbsolute =
    pathApi.isAbsolute(expandedPath) ||
    expandedPath.startsWith("\\\\") ||
    /^[a-zA-Z]:/.test(expandedPath);

  if (isAbsolute) {
    const uri = fsPathToFileUrl(expandedPath);
    const isWithinWorkspace = await isUriWithinWorkspace(ide, uri);
    return {
      uri,
      displayPath: expandedPath,
      isAbsolute: true,
      isWithinWorkspace,
      isInAllowedDirectory: await checkIsInAllowedDirectory(
        ide,
        uri,
        expandedPath,
      ),
    };
  }

  // Handle relative paths...
  const workspaceUri = await resolveRelativePathInDir(expandedPath, ide);
  if (workspaceUri) {
    return {
      uri: workspaceUri,
      displayPath: expandedPath,
      isAbsolute: false,
      isWithinWorkspace: true,
      isInAllowedDirectory: await checkIsInAllowedDirectory(
        ide,
        workspaceUri,
        expandedPath,
      ),
    };
  }

  return null;
}

export function isTrustedFileAccess(resolvedPath: ResolvedPath): boolean {
  return (
    resolvedPath.isWithinWorkspace || resolvedPath.isInAllowedDirectory
  );
}
