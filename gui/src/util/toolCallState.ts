import { ToolPolicy } from "@continuedev/terminal-security";
import { ToolCallDelta, ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { incrementalParseJson } from "core/util/incrementalParseJson";

// Merge streamed tool calls
// See example of data coming in here:
// https://platform.openai.com/docs/guides/function-calling?api-mode=chat#streaming
export function addToolCallDeltaToState(
  toolCallDelta: ToolCallDelta,
  currentState: ToolCallState | undefined,
): ToolCallState {
  const currentCall = currentState?.toolCall;

  // If we have a current state and the delta has a different ID, ignore the delta
  if (
    currentState &&
    toolCallDelta.id &&
    currentCall?.id !== toolCallDelta.id
  ) {
    return currentState;
  }

  // These will/should not be partially streamed
  const callType = toolCallDelta.type ?? "function";
  const callId = currentCall?.id || toolCallDelta.id || "";

  // These may be streamed in chunks
  const currentName = currentCall?.function.name ?? "";
  const currentArgs = currentCall?.function.arguments ?? "";

  const nameDelta = toolCallDelta.function?.name ?? "";
  const argsDelta = toolCallDelta.function?.arguments ?? "";

  let mergedName = currentName;
  if (nameDelta.startsWith(currentName)) {
    // Case where model progresssively streams name but full name each time e.g. "readFi" -> "readFil" -> "readFile"
    mergedName = nameDelta;
  } else if (!currentName.startsWith(nameDelta)) {
    mergedName = currentName + nameDelta;
  }

  // Similar logic for args, with an extra JSON check
  let mergedArgs = currentArgs;
  try {
    // If args is JSON parseable, it is complete, don't add to it
    JSON.parse(currentArgs);
  } catch (e) {
    // Model streams in args in parts e.g. "{"file": "file1"" -> ", "line": 1}"
    mergedArgs = currentArgs + argsDelta;

    // Note, removed case where model progresssively streams args but full args each time e.g. "{"file": "file1"}" -> "{"file": "file1", "line": 1}"
    // Because no apis do this and difficult to detect reliably
  }

  const [_, parsedArgs] = incrementalParseJson(mergedArgs || "{}");

  return {
    status: "generating",
    toolCall: {
      id: callId,
      type: callType,
      function: {
        name: mergedName,
        arguments: mergedArgs,
      },
    },
    toolCallId: callId,
    parsedArgs,
  };
}

const editToolNames: string[] = [
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
];
export function isEditTool(toolName: string) {
  return editToolNames.includes(toolName);
}

/** File write tools that should execute without an Accept click. */
export function shouldSkipToolPermissionPrompt(toolName: string) {
  return isEditTool(toolName) || toolName === BuiltInToolNames.CreateNewFile;
}

export function isMcpTool(tool?: { uri?: string } | null): boolean {
  return !!tool?.uri?.startsWith("mcp:");
}

export function isTerminalCommandTool(toolName: string): boolean {
  return toolName === BuiltInToolNames.RunTerminalCommand;
}

export interface AutoRunSettings {
  autoRunCommands: string[];
  /** Base commands that always require confirmation. */
  dangerousCommands: string[];
  autoRunMcpTools: boolean;
}

/** Default base commands that run without confirmation. */
export const DEFAULT_AUTO_RUN_COMMANDS: string[] = [
  "ls",
  "pwd",
  "cat",
  "echo",
  "git",
  "grep",
  "find",
  "head",
  "tail",
  "which",
  "wc",
  "npm",
  "yarn",
  "pnpm",
];

/** Default base commands that always ask before running. */
export const DEFAULT_DANGEROUS_COMMANDS: string[] = [
  "wget",
  "sudo",
  "su",
  "rm",
  "dd",
  "chmod",
  "chown",
  "ssh",
  "scp",
  "rsync",
  "nc",
  "netcat",
  "eval",
  "exec",
  "kill",
  "killall",
  "pkill",
  "reboot",
  "shutdown",
  "mkfs",
  "iptables",
];

/** Flags that make an allowlisted `find` unsafe to auto-run. */
const FIND_DANGEROUS_FLAGS = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
]);

export interface ParsedTerminalCommand {
  base: string;
  args: string[];
}

/** Matches the UTF-8 setup prefix Continue injects for Windows PowerShell. */
const POWERSHELL_UTF8_PREFIX_RE =
  /^\[Console\]::OutputEncoding\s*=\s*\[System\.Text\.Encoding\]::UTF8\s*;\s*\$OutputEncoding\s*=\s*\[Console\]::OutputEncoding\s*;\s*/i;

/**
 * True for names that are safe to store in the auto-run allowlist
 * (e.g. git, ls, get-childitem) — not PowerShell noise like $x or [Type]::Prop.
 */
export function isValidBaseCommandName(
  base: string | null | undefined,
): boolean {
  if (!base) {
    return false;
  }
  if (
    base.startsWith("$") ||
    base.startsWith("[") ||
    base.startsWith("-") ||
    base.includes("=") ||
    base.includes("::")
  ) {
    return false;
  }
  return /^[a-z][a-z0-9_.+-]*$/i.test(base);
}

export function stripPowerShellBoilerplate(command: string): string {
  return command.replace(POWERSHELL_UTF8_PREFIX_RE, "").trim();
}

function isPowerShellAssignmentSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (/^\$[\w:.]+\s*=/.test(trimmed)) {
    return true;
  }
  if (/^\[[^\]]+\]::[\w.]+\s*=/.test(trimmed)) {
    return true;
  }
  return false;
}

/** Interpreters whose `-c` / `-m` payloads must not leak into the allowlist. */
const SCRIPT_INTERPRETERS = new Set([
  "python",
  "python3",
  "python2",
  "py",
  "node",
  "nodejs",
  "ruby",
  "perl",
  "php",
  "lua",
  "bash",
  "sh",
  "zsh",
  "pwsh",
  "powershell",
]);

/**
 * Quote-aware split on shell operators. Does not split inside '…' / "…".
 * `separators` is a set of operator strings to split on (longest match wins).
 */
export function splitIgnoringQuotes(
  command: string,
  separators: string[],
): string[] {
  const ordered = [...separators].sort((a, b) => b.length - a.length);
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote) {
      current += ch;
      // PowerShell/bash: backslash-escape inside double quotes; single quotes are literal.
      if (ch === quote && (quote === "'" || command[i - 1] !== "\\")) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }

    const matched = ordered.find((op) => command.startsWith(op, i));
    if (matched) {
      const trimmed = current.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
      current = "";
      i += matched.length - 1;
      continue;
    }

    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) {
    parts.push(trimmed);
  }
  return parts;
}

/**
 * Extracts the base command name: the first whitespace-separated token,
 * using only the basename if a path was given (e.g. `/usr/bin/git` → `git`).
 */
export function extractTerminalBaseCommand(
  command: string | null | undefined,
): string | null {
  const parsed = parseTerminalCommand(command);
  if (!parsed || !isValidBaseCommandName(parsed.base)) {
    return null;
  }
  return parsed.base;
}

/**
 * Parses a single shell segment into base command + args.
 * Skips leading env / PowerShell assignments. Basename-normalizes the command.
 */
export function parseTerminalCommand(
  command: string | null | undefined,
): ParsedTerminalCommand | null {
  if (!command || typeof command !== "string") {
    return null;
  }
  const trimmed = stripPowerShellBoilerplate(command.trim());
  if (!trimmed || isPowerShellAssignmentSegment(trimmed)) {
    return null;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let index = 0;
  // Skip Unix-style env assignments: FOO=bar BAZ=1 find ...
  while (index < tokens.length && /^[A-Za-z_][\w]*=.*/.test(tokens[index])) {
    index++;
  }
  // Skip PowerShell `$var = value` token triples at the start of a segment.
  while (
    index + 2 < tokens.length &&
    /^\$[\w:.]+$/.test(tokens[index]) &&
    tokens[index + 1] === "="
  ) {
    index += 3;
  }
  if (index >= tokens.length) {
    return null;
  }

  const rawCommand = tokens[index];
  // Strip call operator (&) and quotes PowerShell often wraps around paths.
  const unwrapped = rawCommand.replace(/^&\s*/, "").replace(/^['"]|['"]$/g, "");
  const basename = unwrapped.split(/[/\\]/).pop() ?? unwrapped;
  const base = basename
    .trim()
    .toLowerCase()
    .replace(/\.exe$/i, "");
  if (!base || !isValidBaseCommandName(base)) {
    return null;
  }

  return {
    base,
    args: tokens.slice(index + 1),
  };
}

/**
 * Splits a command line into segments on common shell operators.
 * Respects single/double quotes so `python -c "a; b"` stays one segment.
 */
export function splitTerminalCommandSegments(command: string): string[] {
  return splitIgnoringQuotes(stripPowerShellBoilerplate(command), [
    "&&",
    "||",
    ";",
    "\n",
    "|",
  ]).filter((segment) => !isPowerShellAssignmentSegment(segment));
}

/**
 * Base commands worth storing via Execute and remember.
 * Skips PowerShell UTF-8 boilerplate, assignments, pipeline tails, and
 * code passed to interpreters via `-c` / `-m` (e.g. python -c "…").
 */
export function extractRememberableBaseCommands(
  command: string | null | undefined,
): string[] {
  if (!command || typeof command !== "string" || !command.trim()) {
    return [];
  }
  const cleaned = stripPowerShellBoilerplate(command);
  // Statements only — do not split on `|` here; we take the first pipeline stage below.
  const statements = splitIgnoringQuotes(cleaned, [
    "&&",
    "||",
    ";",
    "\n",
  ]).filter((segment) => !isPowerShellAssignmentSegment(segment));

  const bases: string[] = [];
  const seen = new Set<string>();
  for (const statement of statements) {
    const firstStage =
      splitIgnoringQuotes(statement, ["|"])[0]?.trim() ?? statement;
    const parsed = parseTerminalCommand(firstStage);
    if (!parsed || !isValidBaseCommandName(parsed.base)) {
      continue;
    }
    // For `python -c "…"`, only remember `python` — never tokens from the payload.
    if (!seen.has(parsed.base)) {
      seen.add(parsed.base);
      bases.push(parsed.base);
    }
    if (SCRIPT_INTERPRETERS.has(parsed.base)) {
      // One interpreter invocation = one remembered command, ignore the rest of the statement.
      continue;
    }
  }
  return bases;
}

/** Resolves the command string from run_terminal_command tool args. */
export function getTerminalCommandFromArgs(
  args: Record<string, unknown> | undefined | null,
): string {
  if (!args) {
    return "";
  }
  if (typeof args.command === "string") {
    return args.command;
  }
  if (Array.isArray(args.commands)) {
    return args.commands
      .filter((item): item is string => typeof item === "string")
      .join("; ");
  }
  return "";
}

/**
 * Extra safety for allowlisted commands: some bases are only safe with
 * certain args (e.g. `find` without `-exec` / `-delete`).
 */
function isAllowlistedInvocationSafe(parsed: ParsedTerminalCommand): boolean {
  if (parsed.base === "find") {
    return !parsed.args.some((arg) => FIND_DANGEROUS_FLAGS.has(arg));
  }
  if (parsed.base === "grep") {
    return !parsed.args.includes("--exec");
  }
  return true;
}

function toCommandSet(commands: string[]): Set<string> {
  return new Set(
    commands.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
  );
}

/** True if any segment's base command is on the dangerous list. */
export function isCommandDangerous(
  command: string | null | undefined,
  dangerousCommands: string[],
): boolean {
  if (!command || typeof command !== "string" || !command.trim()) {
    return false;
  }
  const denylist = toCommandSet(dangerousCommands);
  if (denylist.size === 0) {
    return false;
  }

  for (const segment of splitTerminalCommandSegments(command)) {
    const parsed = parseTerminalCommand(segment);
    if (parsed && denylist.has(parsed.base)) {
      return true;
    }
  }
  return false;
}

export function isCommandAutoApproved(
  command: string | null | undefined,
  autoRunCommands: string[],
  dangerousCommands: string[] = [],
): boolean {
  if (!command || typeof command !== "string" || !command.trim()) {
    return false;
  }

  // Dangerous always wins over the allowlist.
  if (isCommandDangerous(command, dangerousCommands)) {
    return false;
  }

  const allowlist = toCommandSet(autoRunCommands);
  if (allowlist.size === 0) {
    return false;
  }

  const segments = splitTerminalCommandSegments(command);
  const parsedSegments = segments
    .map((segment) => parseTerminalCommand(segment))
    .filter((parsed): parsed is ParsedTerminalCommand => parsed != null);

  // Only real commands count — PowerShell boilerplate / assignments are ignored.
  if (parsedSegments.length === 0) {
    return false;
  }

  for (const parsed of parsedSegments) {
    if (!allowlist.has(parsed.base)) {
      return false;
    }
    if (!isAllowlistedInvocationSafe(parsed)) {
      return false;
    }
  }

  return true;
}

/**
 * Applies auto-run settings on top of the stored tool policy and the
 * command-level security evaluation.
 *
 * Terminal: commands on `dangerousCommands` always ask. Otherwise auto-run
 * when every segment's base is in `autoRunCommands` and passes per-command
 * safety checks (e.g. `find` without `-exec`/`-delete`).
 * Execute and remember moves a base command from dangerous → auto-run.
 * MCP tools have no command-level classifier — the toggle covers every call.
 */
export function resolveAutoRunPolicy(
  toolName: string,
  tool: { uri?: string } | undefined,
  basePolicy: ToolPolicy,
  dynamicPolicy: ToolPolicy,
  autoRun: AutoRunSettings,
  commandText?: string | null,
): ToolPolicy {
  if (basePolicy === "disabled") {
    return "disabled";
  }

  if (autoRun.autoRunMcpTools && isMcpTool(tool)) {
    return "allowedWithoutPermission";
  }

  if (!isTerminalCommandTool(toolName)) {
    return dynamicPolicy;
  }

  if (
    isCommandAutoApproved(
      commandText,
      autoRun.autoRunCommands,
      autoRun.dangerousCommands,
    )
  ) {
    return "allowedWithoutPermission";
  }

  // Dangerous, unknown, or unsafe allowlisted invocation: ask first.
  return "allowedWithPermission";
}

export function shouldAutoAcceptApplyDiff(
  toolName: string | undefined,
  storedPolicy: ToolPolicy | undefined,
  defaultPolicy?: ToolPolicy,
): boolean {
  if (!toolName) {
    return false;
  }

  const effectivePolicy = storedPolicy ?? defaultPolicy;
  if (effectivePolicy === "disabled") {
    return false;
  }

  if (isEditTool(toolName)) {
    return true;
  }

  return effectivePolicy === "allowedWithoutPermission";
}
