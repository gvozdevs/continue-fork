import { Tool, ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { schemaArgsForMultiEdit } from "core/tools/definitions/multiEdit";
import { schemaArgsForSingleFind } from "core/tools/definitions/singleFindAndReplace";
import {
  collectSchemaViolations,
  formatInvalidArgs,
  formatUnknownTool,
  INVALID_ARGS,
  parseToolCallArguments,
  UNKNOWN_TOOL,
} from "core/tools/toolCallValidity";
import { ContinueErrorReason } from "core/util/errors";
import { TOOL_RETRY_HINT } from "core/tools/constants";

import { IIdeMessenger } from "../../context/IdeMessenger";
import {
  errorToolCall,
  setProcessedToolCallArgs,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import { AppThunkDispatch } from "../store";

function rejectToolCall(
  dispatch: AppThunkDispatch,
  toolCallId: string,
  content: string,
): void {
  dispatch(errorToolCall({ toolCallId }));
  dispatch(
    updateToolCallOutput({
      toolCallId,
      contextItems: [
        {
          icon: "problems",
          name: content.startsWith(UNKNOWN_TOOL) ? "Unknown Tool" : "Invalid Tool Call",
          description: "",
          content,
          hidden: false,
        },
      ],
    }),
  );
}

function preprocessErrorContent(toolName: string, errorMessage: string): string {
  if (
    errorMessage.startsWith(`${INVALID_ARGS}:`) ||
    errorMessage.startsWith(`${UNKNOWN_TOOL}:`)
  ) {
    return errorMessage;
  }
    return `${toolName} failed because the arguments were invalid, with the following message: ${errorMessage}\n\n${TOOL_RETRY_HINT}`;
}

export async function preprocessToolCalls(
  dispatch: AppThunkDispatch,
  ideMessenger: IIdeMessenger,
  generatedToolCalls: ToolCallState[],
  knownTools: Tool[],
): Promise<void> {
  const toolsByName = new Map(
    knownTools.map((tool) => [tool.function.name, tool]),
  );

  await Promise.all(
    generatedToolCalls.map(async (tcState) => {
      const toolName = tcState.toolCall.function?.name ?? "";
      const tool = toolsByName.get(toolName);
      if (!tool) {
        rejectToolCall(
          dispatch,
          tcState.toolCallId,
          formatUnknownTool(toolName),
        );
        return;
      }

      const parsed = parseToolCallArguments(tcState.toolCall.function?.arguments);
      if (!parsed.ok) {
        rejectToolCall(
          dispatch,
          tcState.toolCallId,
          formatInvalidArgs(toolName, parsed.violations),
        );
        return;
      }

      const schemaArgs =
        toolName === BuiltInToolNames.SingleFindAndReplace
          ? schemaArgsForSingleFind(parsed.args)
          : toolName === BuiltInToolNames.MultiEdit
            ? schemaArgsForMultiEdit(parsed.args)
            : parsed.args;
      const violations = collectSchemaViolations(
        schemaArgs,
        tool.function.parameters,
      );
      if (violations.length > 0) {
        rejectToolCall(
          dispatch,
          tcState.toolCallId,
          formatInvalidArgs(toolName, violations),
        );
        return;
      }

      let errorReason: ContinueErrorReason | undefined = undefined;
      let errorMessage: string | undefined = undefined;
      let preprocessedArgs: Record<string, unknown> | undefined = undefined;
      const result = await ideMessenger.request("tools/preprocessArgs", {
        toolName,
        args: parsed.args,
      });
      if (result.status === "success") {
        preprocessedArgs = result.content.preprocessedArgs;
        errorMessage = result.content.errorMessage;
        errorReason = result.content.errorReason;
      } else {
        errorMessage = result.error;
        errorReason = ContinueErrorReason.Unknown;
      }
      if (errorReason) {
        rejectToolCall(
          dispatch,
          tcState.toolCallId,
          preprocessErrorContent(toolName, errorMessage ?? "unknown error"),
        );
      } else if (preprocessedArgs) {
        dispatch(
          setProcessedToolCallArgs({
            toolCallId: tcState.toolCallId,
            newArgs: preprocessedArgs,
          }),
        );
      }
    }),
  );
}
