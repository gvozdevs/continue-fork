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

/**
 * Extracts the base command name: the first whitespace-separated token,
 * using only the basename if a path was given (e.g. `/usr/bin/git` → `git`).
 */
export function extractTerminalBaseCommand(
  command: string | null | undefined,
): string | null {
  return parseTerminalCommand(command)?.base ?? null;
}

/**
 * Parses a single shell segment into base command + args.
 * Skips leading `VAR=value` assignments. Basename-normalizes the command.
 */
export function parseTerminalCommand(
  command: string | null | undefined,
): ParsedTerminalCommand | null {
  if (!command || typeof command !== "string") {
    return null;
  }
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let index = 0;
  // Skip env assignments: FOO=bar BAZ=1 find ...
  while (index < tokens.length && /^[A-Za-z_][\w]*=.*/.test(tokens[index])) {
    index++;
  }
  if (index >= tokens.length) {
    return null;
  }

  const rawCommand = tokens[index];
  const basename = rawCommand.split(/[/\\]/).pop() ?? rawCommand;
  const base = basename.trim().toLowerCase();
  if (!base) {
    return null;
  }

  return {
    base,
    args: tokens.slice(index + 1),
  };
}

/**
 * Splits a command line into segments on common shell operators.
 * Quote-unaware — good enough for allowlist checks; ambiguous cases ask first.
 */
export function splitTerminalCommandSegments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||;|\n|\|)/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
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
  if (segments.length === 0) {
    return false;
  }

  for (const segment of segments) {
    const parsed = parseTerminalCommand(segment);
    if (!parsed || !allowlist.has(parsed.base)) {
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
