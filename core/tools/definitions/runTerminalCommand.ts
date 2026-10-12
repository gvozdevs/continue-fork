import os from "os";
import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import {
  evaluateTerminalCommandSecurity,
  ToolPolicy,
} from "@continuedev/terminal-security";

/**
 * Get the preferred shell for the current platform
 * @returns The preferred shell command or path
 */
function getPreferredShell(): string {
  const platform = os.platform();

  if (platform === "win32") {
    return "powershell.exe";
  } else if (platform === "darwin") {
    return process.env.SHELL || "/bin/zsh";
  } else {
    // Linux and other Unix-like systems
    return process.env.SHELL || "/bin/bash";
  }
}

const PLATFORM_INFO = `Choose terminal commands and scripts optimized for ${os.platform()} and ${os.arch()} and shell ${getPreferredShell()}.`;

const RUN_COMMAND_NOTES = `The shell is not stateful and will not remember any previous commands.\
      Put the command in this call; do not write it in the reply.\
      Do NOT perform actions requiring special/admin privileges.\
      IMPORTANT: To create or edit files, use the file tool instead of shell commands (sed, awk, echo, etc). Use ls or file_glob_search to list a directory. Use this tool to check git status, show a git diff, build, or run tests.\
      Long output is cut to its last part, so pass filters such as a grep or a line limit when only a summary is needed.\
      ${PLATFORM_INFO}`;

export const runTerminalCommandTool: Tool = {
  type: "function",
  displayTitle: "Run Terminal Command",
  wouldLikeTo: "run the following terminal command:",
  isCurrently: "running the following terminal command:",
  hasAlready: "ran the following terminal command:",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.RunTerminalCommand,
    description: `Run a terminal command in the current directory.\n${RUN_COMMAND_NOTES}`,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The command to run. This will be passed directly into the IDE shell.",
        },
        commands: {
          type: "array",
          items: { type: "string" },
          description:
            "Several commands to run in this one call, in order, in the same shell.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  evaluateToolCallPolicy: (
    basePolicy: ToolPolicy,
    parsedArgs: Record<string, unknown>,
  ): ToolPolicy => {
    const command =
      typeof parsedArgs.command === "string"
        ? parsedArgs.command
        : Array.isArray(parsedArgs.commands)
          ? parsedArgs.commands.filter((item) => typeof item === "string").join("; ")
          : "";
    return evaluateTerminalCommandSecurity(basePolicy, command);
  },
  systemMessageDescription: {
    prefix: `To run a terminal command, use the ${BuiltInToolNames.RunTerminalCommand} tool
${RUN_COMMAND_NOTES}
For example, to see the git log, you could respond with:`,
    exampleArgs: [["command", "git log"]],
  },
};
