import { ToolPolicy } from "@continuedev/terminal-security";
import { Tool, ToolCallState } from "core";
import { POLICY_BLOCKED } from "core/tools/toolCallValidity";
import { IIdeMessenger } from "../../context/IdeMessenger";
import {
  AutoRunSettings,
  DEFAULT_AUTO_RUN_COMMANDS,
  DEFAULT_DANGEROUS_COMMANDS,
  getTerminalCommandFromArgs,
  isMcpTool,
  isTerminalCommandTool,
  resolveAutoRunPolicy,
  shouldSkipToolPermissionPrompt,
} from "../../util/toolCallState";
import { errorToolCall, updateToolCallOutput } from "../slices/sessionSlice";
import { DEFAULT_TOOL_SETTING, ToolPolicies } from "../slices/uiSlice";
import { AppThunkDispatch } from "../store";

interface EvaluatedPolicy {
  policy: ToolPolicy;
  displayValue?: string;
  toolCallState: ToolCallState;
}

const DEFAULT_AUTO_RUN: AutoRunSettings = {
  autoRunCommands: [...DEFAULT_AUTO_RUN_COMMANDS],
  dangerousCommands: [...DEFAULT_DANGEROUS_COMMANDS],
  autoRunMcpTools: false,
};

/**
 * Evaluates the tool policy for a tool call, including dynamic policy evaluation
 * Note that tool group policies are not considered here because activeTools already excludes disabled groups
 */
async function evaluateToolPolicy(
  ideMessenger: IIdeMessenger,
  activeTools: Tool[],
  toolCallState: ToolCallState,
  toolPolicies: ToolPolicies,
  autoRun: AutoRunSettings,
): Promise<EvaluatedPolicy> {
  const toolName = toolCallState.toolCall.function.name;
  const tool =
    toolCallState.tool ??
    activeTools.find((candidate) => candidate.function.name === toolName);
  const basePolicy =
    toolPolicies[toolName] ?? tool?.defaultToolPolicy ?? DEFAULT_TOOL_SETTING;

  // File writes skip the Accept click unless the tool is explicitly disabled.
  if (basePolicy !== "disabled" && shouldSkipToolPermissionPrompt(toolName)) {
    return { policy: "allowedWithoutPermission", toolCallState };
  }

  const result = await ideMessenger.request("tools/evaluatePolicy", {
    toolName,
    basePolicy,
    parsedArgs: toolCallState.parsedArgs,
    processedArgs: toolCallState.processedArgs,
  });

  // Evaluate the policy dynamically
  if (result.status === "error") {
    console.error(`Error evaluating tool policy for ${toolName}`, result.error);
    return { policy: "disabled", toolCallState };
  }

  const dynamicPolicy = result.content.policy;
  const displayValue = result.content.displayValue;
  const commandText = isTerminalCommandTool(toolName)
    ? getTerminalCommandFromArgs(
        toolCallState.processedArgs ?? toolCallState.parsedArgs,
      )
    : undefined;

  const resolvedPolicy = resolveAutoRunPolicy(
    toolName,
    tool,
    basePolicy,
    dynamicPolicy,
    autoRun,
    commandText,
  );

  if (resolvedPolicy === "disabled") {
    return { policy: "disabled", displayValue, toolCallState };
  }

  if (isTerminalCommandTool(toolName) || isMcpTool(tool)) {
    return { policy: resolvedPolicy, displayValue, toolCallState };
  }

  // Dynamic policy cannot be more lenient than the stored base policy
  if (
    basePolicy === "allowedWithPermission" &&
    dynamicPolicy === "allowedWithoutPermission"
  ) {
    return { policy: "allowedWithPermission", displayValue, toolCallState };
  }

  return { policy: dynamicPolicy, displayValue, toolCallState };
}

/*
    1. Get arg-dependent tool policies from core
    2. Mark any disabled ones as errored
    3. Mark others as generated
*/
export async function evaluateToolPolicies(
  dispatch: AppThunkDispatch,
  ideMessenger: IIdeMessenger,
  activeTools: Tool[],
  generatedToolCalls: ToolCallState[],
  toolPolicies: ToolPolicies,
  autoRun: AutoRunSettings = DEFAULT_AUTO_RUN,
): Promise<EvaluatedPolicy[]> {
  // Check if ALL tool calls are auto-approved using dynamic evaluation
  const policyResults = await Promise.all(
    generatedToolCalls.map((toolCallState) =>
      evaluateToolPolicy(
        ideMessenger,
        activeTools,
        toolCallState,
        toolPolicies,
        autoRun,
      ),
    ),
  );

  const disabledResults = policyResults.filter(
    ({ policy }) => policy === "disabled",
  );

  for (const { displayValue, toolCallState } of disabledResults) {
    dispatch(errorToolCall({ toolCallId: toolCallState.toolCallId }));

    // Use the displayValue from the policy evaluation, or fallback to function name
    const command = displayValue || toolCallState.toolCall.function.name;

    // Add error message explaining why it's disabled
    dispatch(
      updateToolCallOutput({
        toolCallId: toolCallState.toolCallId,
        contextItems: [
          {
            icon: "problems",
            name: "Security Policy Violation",
            description: "Command Disabled",
            content: `${POLICY_BLOCKED}: This command has been disabled by security policy:\n\n${command}\n\nThis command cannot be executed as it may pose a security risk.`,
            hidden: false,
          },
        ],
      }),
    );
  }

  return policyResults;
}
