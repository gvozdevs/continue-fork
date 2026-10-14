import { ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { EditOperation } from "core/tools/definitions/multiEdit";
import { AskQuestion } from "./AskQuestion";
import { CreateFile } from "./CreateFile";
import { EditFile } from "./EditFile";
import { FindAndReplaceDisplay } from "./FindAndReplace";
import { RunTerminalCommand } from "./RunTerminalCommand";

function isNewFileCall(
  processedArgs: Record<string, any> | undefined,
  args: Record<string, any> | undefined,
): boolean {
  if (processedArgs?.creating === true) {
    return true;
  }
  if (typeof args?.contents !== "string") {
    return false;
  }
  if (Array.isArray(args.replacements) && args.replacements.length > 0) {
    return false;
  }
  if (Array.isArray(args.edits) && args.edits.length > 0) {
    return false;
  }
  if (
    !Array.isArray(args.replacements) &&
    (args.old_string !== undefined || args.new_string !== undefined)
  ) {
    return false;
  }
  return true;
}

function FunctionSpecificToolCallDiv({
  toolCallState,
  historyIndex,
}: {
  toolCallState: ToolCallState;
  historyIndex: number;
}) {
  const args = toolCallState.parsedArgs;
  const processedArgs = toolCallState.processedArgs;
  const toolCall = toolCallState.toolCall;

  switch (toolCall.function?.name) {
    case BuiltInToolNames.AskQuestion:
      return <AskQuestion toolCallState={toolCallState} />;
    case BuiltInToolNames.CreateNewFile:
      return (
        <CreateFile
          relativeFilepath={args?.filepath ?? ""}
          fileContents={args?.contents ?? ""}
          historyIndex={historyIndex}
        />
      );
    case BuiltInToolNames.EditExistingFile:
      return (
        <EditFile
          relativeFilePath={processedArgs?.filepath ?? args?.filepath ?? ""}
          changes={processedArgs?.changes ?? args?.changes ?? ""}
          toolCallId={toolCall.id}
          historyIndex={historyIndex}
        />
      );
    case BuiltInToolNames.SingleFindAndReplace:
      if (isNewFileCall(processedArgs, args)) {
        return (
          <CreateFile
            relativeFilepath={args?.filepath ?? ""}
            fileContents={
              processedArgs?.newFileContents ?? args?.contents ?? ""
            }
            historyIndex={historyIndex}
          />
        );
      }
      const replacementSource = Array.isArray(processedArgs?.edits)
        ? processedArgs.edits
        : Array.isArray(args?.replacements)
          ? args.replacements
          : [
              {
                old_string: processedArgs?.old_string ?? args?.old_string ?? "",
                new_string: processedArgs?.new_string ?? args?.new_string ?? "",
              },
            ];
      const edits: EditOperation[] = replacementSource.map(
        (edit: EditOperation) => ({
          old_string: edit?.old_string ?? "",
          new_string: edit?.new_string ?? "",
          replace_all: false,
        }),
      );
      return (
        <FindAndReplaceDisplay
          editingFileContents={processedArgs?.editingFileContents}
          fileUri={processedArgs?.fileUri ?? ""}
          newFileContents={processedArgs?.newFileContents}
          relativeFilePath={processedArgs?.filepath ?? args?.filepath ?? ""}
          edits={edits}
          toolCallId={toolCall.id}
          historyIndex={historyIndex}
        />
      );
    case BuiltInToolNames.MultiEdit:
      if (isNewFileCall(processedArgs, args)) {
        return (
          <CreateFile
            relativeFilepath={args?.filepath ?? ""}
            fileContents={
              processedArgs?.newFileContents ?? args?.contents ?? ""
            }
            historyIndex={historyIndex}
          />
        );
      }
      return (
        <FindAndReplaceDisplay
          editingFileContents={processedArgs?.editingFileContents}
          relativeFilePath={processedArgs?.filepath ?? args?.filepath ?? ""}
          fileUri={processedArgs?.fileUri ?? ""}
          newFileContents={processedArgs?.newFileContents}
          edits={processedArgs?.edits ?? args?.edits ?? []}
          toolCallId={toolCall.id}
          historyIndex={historyIndex}
        />
      );
    case BuiltInToolNames.RunTerminalCommand:
      return (
        <RunTerminalCommand
          command={
            typeof args?.command === "string"
              ? args.command
              : Array.isArray(args?.commands)
                ? args.commands
                    .filter((c: unknown) => typeof c === "string")
                    .join("; ")
                : ""
          }
          toolCallState={toolCallState}
          toolCallId={toolCall.id}
        />
      );
    default:
      return null;
  }
}

export default FunctionSpecificToolCallDiv;
