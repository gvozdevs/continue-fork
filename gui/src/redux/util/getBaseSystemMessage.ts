import { ModelDescription, Tool } from "core";
import {
  buildAgentSystemMessage,
  buildLanguageSection,
  buildPlanSystemMessage,
  DEFAULT_CHAT_SYSTEM_MESSAGE,
  SystemMessageVars,
} from "core/llm/defaultSystemMessages";
import { BuiltInToolNames } from "core/tools/builtIn";

export const NO_TOOL_WARNING =
  "\n\nTHE USER HAS NOT PROVIDED ANY TOOLS, DO NOT ATTEMPT TO USE ANY TOOLS. STOP AND LET THE USER KNOW THAT THERE ARE NO TOOLS AVAILABLE. The user can provide tools by enabling them in the Tool Policies section of the notch (wrench icon)";

export type GetBaseSystemMessageOptions = {
  /** Shared-settings / ui override for agent template */
  agentSystemMessage?: string;
  /** Shared-settings / ui override for plan template */
  planSystemMessage?: string;
  cwd?: string;
  date?: string;
  /** Preferred reply language, e.g. "Russian" */
  language?: string;
};

function resolveFileTool(activeTools?: Tool[]) {
  const hasMultiEdit = activeTools?.some(
    (tool) => tool.function.name === BuiltInToolNames.MultiEdit,
  );
  return hasMultiEdit ? "multi_edit" : "single_find_and_replace";
}

function templateVars(
  activeTools?: Tool[],
  options?: GetBaseSystemMessageOptions,
): Partial<SystemMessageVars> {
  return {
    fileTool: resolveFileTool(activeTools),
    cwd: options?.cwd,
    date: options?.date,
    language: options?.language,
  };
}

function defaultAgentSystemMessage(
  activeTools?: Tool[],
  options?: GetBaseSystemMessageOptions,
): string {
  return buildAgentSystemMessage(
    resolveFileTool(activeTools),
    options?.agentSystemMessage?.trim() || undefined,
    templateVars(activeTools, options),
  );
}

function defaultPlanSystemMessage(
  activeTools?: Tool[],
  options?: GetBaseSystemMessageOptions,
): string {
  return buildPlanSystemMessage(
    options?.planSystemMessage?.trim() || undefined,
    templateVars(activeTools, options),
  );
}

function withChatLanguage(message: string, language?: string): string {
  const section = buildLanguageSection(language);
  if (!section || message.includes("# Language")) {
    return message;
  }
  return `${message.trimEnd()}\n\n${section}`;
}

/**
 * Resolve the base system message for the current mode.
 * Priority for agent/plan:
 * 1. Model chatOptions override (baseAgentSystemMessage / basePlanSystemMessage)
 * 2. User settings template (ui.agentSystemMessage / ui.planSystemMessage)
 * 3. Built-in default template
 * Language from ui.userLanguage is injected like Claude's # Language section.
 */
export function getBaseSystemMessage(
  messageMode: string,
  model: ModelDescription,
  activeTools?: Tool[],
  options?: GetBaseSystemMessageOptions,
): string {
  let baseMessage: string;
  const vars = templateVars(activeTools, options);

  if (messageMode === "agent") {
    if (model.baseAgentSystemMessage?.trim()) {
      baseMessage = buildAgentSystemMessage(
        resolveFileTool(activeTools),
        model.baseAgentSystemMessage,
        vars,
      );
    } else {
      baseMessage = defaultAgentSystemMessage(activeTools, options);
    }
  } else if (messageMode === "plan") {
    if (model.basePlanSystemMessage?.trim()) {
      baseMessage = buildPlanSystemMessage(model.basePlanSystemMessage, vars);
    } else {
      baseMessage = defaultPlanSystemMessage(activeTools, options);
    }
  } else {
    baseMessage = withChatLanguage(
      model.baseChatSystemMessage ?? DEFAULT_CHAT_SYSTEM_MESSAGE,
      options?.language,
    );
  }

  // Add no-tools warning for agent/plan modes when no tools are available
  if (messageMode !== "chat" && (!activeTools || activeTools.length === 0)) {
    baseMessage += NO_TOOL_WARNING;
  }

  return baseMessage;
}
