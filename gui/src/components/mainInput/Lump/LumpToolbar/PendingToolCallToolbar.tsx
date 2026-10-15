import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import { selectPendingToolCalls } from "../../../../redux/selectors/selectToolCalls";
import { rememberAutoRunCommand } from "../../../../redux/slices/uiSlice";
import { callToolById } from "../../../../redux/thunks/callToolById";
import { cancelToolCallThunk } from "../../../../redux/thunks/cancelToolCall";
import { getAltKeyLabel, getMetaKeyLabel, isJetBrains } from "../../../../util";
import {
  extractRememberableBaseCommands,
  getTerminalCommandFromArgs,
  isTerminalCommandTool,
} from "../../../../util/toolCallState";
import { Button } from "../../../ui";
import { useMainEditor } from "../../TipTapEditor";

export const generateToolCallButtonTestId = (
  action: "accept" | "reject" | "remember",
  toolCallId: string,
) => {
  return `${action}-tool-call-button-${toolCallId}`;
};

export function PendingToolCallToolbar() {
  const dispatch = useAppDispatch();
  const jetbrains = isJetBrains();
  const pendingToolCalls = useAppSelector(selectPendingToolCalls);
  const editor = useMainEditor();

  if (pendingToolCalls.length === 0) {
    return null;
  }

  const handleAccept = (toolCallId: string) => {
    void dispatch(callToolById({ toolCallId }));
  };

  const handleAcceptAndRemember = (toolCallId: string) => {
    const toolCall = pendingToolCalls.find(
      (candidate) => candidate.toolCallId === toolCallId,
    );
    if (toolCall && isTerminalCommandTool(toolCall.toolCall.function.name)) {
      const commandText = getTerminalCommandFromArgs(
        toolCall.processedArgs ?? toolCall.parsedArgs,
      );
      // Remember real base commands only (skips PowerShell boilerplate,
      // assignments, and pipeline tails like Select-Object).
      for (const base of extractRememberableBaseCommands(commandText)) {
        dispatch(rememberAutoRunCommand(base));
      }
    }
    void dispatch(callToolById({ toolCallId }));
  };

  const handleReject = (toolCallId: string) => {
    // put cursor in editor after last rejection
    if (pendingToolCalls.length === 1) {
      editor.mainEditor?.commands.focus();
    }
    void dispatch(cancelToolCallThunk({ toolCallId }));
  };

  return (
    <div className="flex w-full flex-col pb-0.5">
      {pendingToolCalls.map((toolCall, index) => {
        const isTerminal = isTerminalCommandTool(
          toolCall.toolCall.function.name,
        );
        const title =
          toolCall.tool?.displayTitle ?? toolCall.toolCall.function.name;
        const commandPreview = isTerminal
          ? getTerminalCommandFromArgs(
              toolCall.processedArgs ?? toolCall.parsedArgs,
            )
          : "";

        return (
          <div
            key={toolCall.toolCallId}
            className="border-input bg-input flex items-center gap-2 rounded border"
          >
            <span className="text-description flex-1 truncate text-xs italic">
              {isTerminal && commandPreview
                ? `${title}: ${commandPreview}`
                : title}
            </span>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-description-muted my-1 font-medium"
                onClick={() => handleReject(toolCall.toolCallId)}
                data-testid={generateToolCallButtonTestId(
                  "reject",
                  toolCall.toolCallId,
                )}
              >
                {/* JetBrains overrides cmd+backspace, so we have to use another shortcut */}
                {index === 0 && (
                  <span className="text-2xs mr-1">
                    {jetbrains ? getAltKeyLabel() : getMetaKeyLabel()}⌫
                  </span>
                )}
                <span>Reject</span>
              </Button>

              {isTerminal ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="my-1 font-medium"
                    onClick={() => handleAccept(toolCall.toolCallId)}
                    data-testid={generateToolCallButtonTestId(
                      "accept",
                      toolCall.toolCallId,
                    )}
                  >
                    {index === 0 && (
                      <span className="text-2xs mr-1">
                        {getMetaKeyLabel()}⏎
                      </span>
                    )}
                    <span>Execute</span>
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className="my-1 font-medium"
                    onClick={() => handleAcceptAndRemember(toolCall.toolCallId)}
                    data-testid={generateToolCallButtonTestId(
                      "remember",
                      toolCall.toolCallId,
                    )}
                  >
                    <span>Execute and remember</span>
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  className="my-1 font-medium"
                  onClick={() => handleAccept(toolCall.toolCallId)}
                  data-testid={generateToolCallButtonTestId(
                    "accept",
                    toolCall.toolCallId,
                  )}
                >
                  {index === 0 && (
                    <span className="text-2xs mr-1">{getMetaKeyLabel()}⏎</span>
                  )}
                  <span>Accept</span>
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
