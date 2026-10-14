import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { LLMFullCompletionOptions, ModelDescription } from "core";
import { getRuleId } from "core/llm/rules/getSystemMessageWithRules";
import { ToCoreProtocol } from "core/protocol";
import { BUILT_IN_GROUP_NAME } from "core/tools/builtIn";
import {
  malformedToolCallReason,
  toMalformedResponseError,
  isMalformedStreamError,
} from "core/tools/toolCallValidity";
import {
  EMPTY_TOOL_LOOP,
  PHRASE_LOOP_RESUME,
  TOOL_LOOP_STOP,
  currentReplyWithoutTools,
  noteAgentProgress,
  shouldAbortStreamingPhraseLoop,
  shouldNudgeForMissingToolCall,
} from "core/tools/toolCallLoop";
import { selectActiveTools } from "../selectors/selectActiveTools";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  abortStream,
  addPromptCompletionPair,
  appendLoopResume,
  clearStalledAssistantReply,
  errorToolCall,
  setActive,
  setAppliedRulesAtIndex,
  setContextPercentage,
  setContextUsage,
  setInactive,
  setInlineErrorMessage,
  setToolLoop,
  setIsPruned,
  setToolGenerated,
  streamUpdate,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { constructMessages } from "../util/constructMessages";

import { modelSupportsNativeTools } from "core/llm/toolSupport";
import {
  shouldAutoCompactContext,
  staleHistoryTokenLimit,
} from "core/util/autoCompact";
import { applyToolOverrides } from "core/tools/applyToolOverrides";
import { addSystemMessageToolsToSystemMessage } from "core/tools/systemMessageTools/buildToolsSystemMessage";
import { interceptSystemToolCalls } from "core/tools/systemMessageTools/interceptSystemToolCalls";
import { SystemMessageToolCodeblocksFramework } from "core/tools/systemMessageTools/toolCodeblocks";

import {
  selectCurrentToolCalls,
  selectPendingToolCalls,
} from "../selectors/selectToolCalls";
import { getBaseSystemMessage } from "../util/getBaseSystemMessage";
import { autoCompactHistoryIfNeeded, staleHistoryTokens } from "./autoCompact";
import { callToolById } from "./callToolById";
import { evaluateToolPolicies } from "./evaluateToolPolicies";
import { preprocessToolCalls } from "./preprocessToolCallArgs";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

/**
 * Builds completion options with reasoning configuration based on session state and model capabilities.
 *
 * @param baseOptions - Base completion options to extend
 * @param hasReasoningEnabled - Whether reasoning is enabled in the session
 * @param model - The selected model with provider and completion options
 * @returns Completion options with reasoning configuration
 */
function buildReasoningCompletionOptions(
  baseOptions: LLMFullCompletionOptions,
  hasReasoningEnabled: boolean | undefined,
  model: ModelDescription,
): LLMFullCompletionOptions {
  if (hasReasoningEnabled === undefined) {
    return baseOptions;
  }

  const reasoningOptions: LLMFullCompletionOptions = {
    ...baseOptions,
    reasoning: !!hasReasoningEnabled,
  };

  // Add reasoning budget tokens if reasoning is enabled and provider supports it
  if (hasReasoningEnabled && model.underlyingProviderName !== "ollama") {
    // Ollama doesn't support limiting reasoning tokens at this point
    reasoningOptions.reasoningBudgetTokens =
      model.completionOptions?.reasoningBudgetTokens ?? 2048;
  }

  if (hasReasoningEnabled && model.completionOptions?.reasoningEffort) {
    reasoningOptions.reasoningEffort = model.completionOptions.reasoningEffort;
  }

  return reasoningOptions;
}

export const streamNormalInput = createAsyncThunk<
  void,
  {
    legacySlashCommandData?: ToCoreProtocol["llm/streamChat"][0]["legacySlashCommandData"];
    depth?: number;
  },
  ThunkApiType
>(
  "chat/streamNormalInput",
  async (
    { legacySlashCommandData, depth = 0 },
    { dispatch, extra, getState },
  ) => {
    if (process.env.NODE_ENV === "test" && depth > 50) {
      const message = `Max stream depth of ${50} reached in test`;
      console.error(message, JSON.stringify(getState(), null, 2));
      throw new Error(message);
    }
    if (depth === 0) {
      dispatch(setToolLoop(EMPTY_TOOL_LOOP));
    }

    const executeAutoTools = async (
      calls: {
        toolCallId: string;
        toolCall: { function: { name: string; arguments?: string } };
      }[],
    ) => {
      const history = getState().session.history;
      const assistantText = [...history]
        .reverse()
        .find(
          (item) =>
            item.message.role === "assistant" &&
            item.toolCallStates?.some((toolCall) =>
              calls.some((call) => call.toolCallId === toolCall.toolCallId),
            ),
        );
      const text =
        typeof assistantText?.message.content === "string"
          ? assistantText.message.content
          : "";
      const noted = noteAgentProgress(
        getState().session.toolLoop ?? EMPTY_TOOL_LOOP,
        {
          calls: calls.map((call) => ({
            name: call.toolCall.function.name,
            arguments: call.toolCall.function.arguments ?? "",
          })),
          assistantText: text,
        },
      );
      dispatch(setToolLoop(noted.state));
      if (noted.action === "stop") {
        for (const call of calls) {
          dispatch(
            errorToolCall({
              toolCallId: call.toolCallId,
              output: [
                {
                  icon: "problems",
                  name: "Tool loop",
                  description: "Stopped",
                  content: noted.notice ?? TOOL_LOOP_STOP,
                  hidden: false,
                },
              ],
            }),
          );
        }
        dispatch(setInactive());
        return;
      }
      await Promise.all(
        calls.map(async (call) => {
          unwrapResult(
            await dispatch(
              callToolById({
                toolCallId: call.toolCallId,
                isAutoApproved: true,
                depth: depth + 1,
                loopNotice: noted.action === "warn" ? noted.notice : undefined,
              }),
            ),
          );
        }),
      );
    };
    const state = getState();
    const selectedChatModel = selectSelectedChatModel(state);

    if (!selectedChatModel) {
      throw new Error("No chat model selected");
    }

    // Get tools and apply model-level overrides (disabled, description, etc.)
    let activeTools = selectActiveTools(state);
    if (selectedChatModel.toolOverrides?.length) {
      const { tools: overriddenTools, errors } = applyToolOverrides(
        activeTools,
        selectedChatModel.toolOverrides,
      );
      activeTools = overriddenTools;
      for (const error of errors) {
        if (!error.fatal) {
          console.warn(`Tool override warning: ${error.message}`);
        }
      }
    }

    // Use the centralized selector to determine if system message tools should be used
    const useNativeTools = state.config.config.experimental
      ?.onlyUseSystemMessageTools
      ? false
      : modelSupportsNativeTools(selectedChatModel);
    const systemToolsFramework = !useNativeTools
      ? new SystemMessageToolCodeblocksFramework()
      : undefined;

    // Construct completion options
    let completionOptions: LLMFullCompletionOptions = {};
    if (useNativeTools && activeTools.length > 0) {
      completionOptions = {
        tools: activeTools,
      };
    }

    completionOptions = buildReasoningCompletionOptions(
      completionOptions,
      state.session.hasReasoningEnabled,
      selectedChatModel,
    );

    // Construct messages (excluding system message)
    const baseSystemMessage = getBaseSystemMessage(
      state.session.mode,
      selectedChatModel,
      activeTools,
      {
        agentSystemMessage: state.config.config.ui?.agentSystemMessage,
        planSystemMessage: state.config.config.ui?.planSystemMessage,
        cwd: window.workspacePaths?.[0],
        language: state.config.config.ui?.userLanguage || "Russian",
      },
    );

    const systemMessage = systemToolsFramework
      ? addSystemMessageToolsToSystemMessage(
          systemToolsFramework,
          baseSystemMessage,
          activeTools,
        )
      : baseSystemMessage;

    const buildMessages = () => {
      const stateNow = getState();
      const withoutMessageIds = stateNow.session.history.map((item) => {
        const { id, ...messageWithoutId } = item.message;
        return { ...item, message: messageWithoutId };
      });
      return constructMessages(
        withoutMessageIds,
        systemMessage,
        stateNow.config.config.rules,
        stateNow.ui.ruleSettings,
        systemToolsFramework,
      );
    };

    let { messages, appliedRules, appliedRuleIndex } = buildMessages();

    const dispatchAppliedRules = () => {
      // TODO parallel tool calls will cause issues with this
      // because there will be multiple tool messages, so which one should have applied rules?
      dispatch(
        setAppliedRulesAtIndex({
          index: appliedRuleIndex,
          appliedRules: appliedRules,
        }),
      );
    };
    dispatchAppliedRules();

    dispatch(setActive());
    dispatch(setInlineErrorMessage(undefined));

    const compileMessages = (nextMessages: typeof messages) =>
      extra.ideMessenger.request("llm/compileChat", {
        messages: nextMessages,
        options: completionOptions,
      });

    let precompiledRes = await compileMessages(messages);
    const notEnoughContext =
      precompiledRes.status === "error" &&
      precompiledRes.error.includes("Not enough context");
    const compiled =
      precompiledRes.status === "success" ? precompiledRes.content : undefined;

    const ui = getState().config.config.ui;
    const autoCompactEnabled = ui?.autoCompactContext !== false;
    const compactStaleHistory = ui?.compactStaleHistory === true;
    const staleTokenLimit = staleHistoryTokenLimit(ui?.staleHistoryTokenLimit);
    const staleTokens = staleHistoryTokens(getState().session.history);
    if (
      autoCompactEnabled &&
      shouldAutoCompactContext({
        notEnoughContext,
        didPrune: compiled?.didPrune,
        contextPercentage: compiled?.contextPercentage,
        staleTokens,
        compactStaleHistory,
        staleTokenLimit,
      })
    ) {
      const compacted = await autoCompactHistoryIfNeeded({
        dispatch,
        getState,
        ideMessenger: extra.ideMessenger,
        contextPercentage: compiled?.contextPercentage,
        didPrune: compiled?.didPrune,
        notEnoughContext,
        staleTokens,
        compactStaleHistory,
        staleTokenLimit,
      });
      if (compacted && getState().session.isStreaming) {
        ({ messages, appliedRules, appliedRuleIndex } = buildMessages());
        dispatchAppliedRules();
        precompiledRes = await compileMessages(messages);
      }
    }

    if (precompiledRes.status === "error") {
      if (precompiledRes.error.includes("Not enough context")) {
        dispatch(setInlineErrorMessage("out-of-context"));
        dispatch(setInactive());
        return;
      } else {
        throw new Error(precompiledRes.error);
      }
    }

    const {
      compiledChatMessages,
      didPrune,
      contextPercentage,
      inputTokens,
      contextLength,
    } = precompiledRes.content;

    dispatch(setIsPruned(didPrune));
    dispatch(setContextPercentage(contextPercentage));
    if (inputTokens !== undefined && contextLength !== undefined) {
      dispatch(setContextUsage({ inputTokens, contextLength }));
    }

    const start = Date.now();
    const streamAborter = state.session.streamAborter;
    let abortedForNudge = false;
    const isAbortError = (error: unknown) =>
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error &&
        (error.name === "AbortError" ||
          error.message.toLowerCase().includes("abort")));
    const streamStopped = () =>
      !getState().session.isStreaming ||
      (streamAborter.signal.aborted && !abortedForNudge);
    try {
      let gen = extra.ideMessenger.llmStreamChat(
        {
          completionOptions,
          title: selectedChatModel.title,
          messages: compiledChatMessages,
          legacySlashCommandData,
          messageOptions: { precompiled: true },
        },
        streamAborter.signal,
      );
      if (systemToolsFramework && activeTools.length > 0) {
        gen = interceptSystemToolCalls(
          gen,
          streamAborter,
          systemToolsFramework,
        );
      }

      let next = await gen.next();
      while (!next.done) {
        if (!getState().session.isStreaming) {
          dispatch(abortStream());
          break;
        }

        dispatch(streamUpdate(next.value));
        if (
          activeTools.length > 0 &&
          state.session.mode === "agent" &&
          shouldAbortStreamingPhraseLoop(getState().session.history)
        ) {
          abortedForNudge = true;
          dispatch(abortStream());
          break;
        }
        next = await gen.next();
      }

      // Attach prompt log and end thinking for reasoning models
      if (next.done && next.value) {
        dispatch(addPromptCompletionPair([next.value]));

        try {
          extra.ideMessenger.post("devdata/log", {
            name: "chatInteraction",
            data: {
              prompt: next.value.prompt,
              completion: next.value.completion,
              modelProvider: selectedChatModel.underlyingProviderName,
              modelName: selectedChatModel.title,
              modelTitle: selectedChatModel.title,
              sessionId: state.session.id,
              ...(!!activeTools.length && {
                tools: activeTools.map((tool) => tool.function.name),
              }),
              ...(appliedRules.length > 0 && {
                rules: appliedRules.map((rule) => ({
                  id: getRuleId(rule),
                  slug: rule.slug,
                })),
              }),
            },
          });
        } catch (e) {
          console.error("Failed to send dev data interaction log", e);
        }
      }
    } catch (e) {
      if (abortedForNudge || isAbortError(e)) {
        // The request was stopped on purpose: user cancel or a phrase loop abort.
      } else if (isMalformedStreamError(e)) {
        throw toMalformedResponseError(e);
      }
      const toolCallsToCancel = selectCurrentToolCalls(getState());
      if (
        toolCallsToCancel.length > 0 &&
        e instanceof Error &&
        e.message.toLowerCase().includes("premature close")
      ) {
        for (const tc of toolCallsToCancel) {
          dispatch(
            errorToolCall({
              toolCallId: tc.toolCallId,
              output: [
                {
                  name: "Tool Call Error",
                  description: "Premature Close",
                  content: `"Premature Close" error: this tool call was aborted mid-stream because the arguments took too long to stream or there were network issues. Please re-attempt by breaking the operation into smaller chunks or trying something else`,
                  icon: "problems",
                },
              ],
            }),
          );
        }
      } else {
        throw e;
      }
    }

    // Tool call sequence:
    // 1. A tool call without an id or name is a broken stream, not a tool.
    const state1 = getState();
    if (streamStopped()) {
      return;
    }
    const originalToolCalls = selectCurrentToolCalls(state1);
    const malformed = originalToolCalls
      .map((tc) => malformedToolCallReason(tc.toolCall))
      .find((reason): reason is string => !!reason);
    if (malformed) {
      throw toMalformedResponseError(new Error(malformed));
    }
    const generatingCalls = originalToolCalls.filter(
      (tc) => tc.status === "generating",
    );
    for (const { toolCallId } of generatingCalls) {
      dispatch(
        setToolGenerated({
          toolCallId,
          tools: state1.config.config.tools,
        }),
      );
    }

    // 2. Pre-process args to catch invalid args before checking policies
    const state2 = getState();
    if (streamStopped()) {
      return;
    }
    const generatedCalls2 = selectPendingToolCalls(state2);
    await preprocessToolCalls(
      dispatch,
      extra.ideMessenger,
      generatedCalls2,
      state2.config.config.tools,
    );

    // 3. Security check: evaluate updated policies based on args
    const state3 = getState();
    if (streamStopped()) {
      return;
    }
    const generatedCalls3 = selectPendingToolCalls(state3);
    const toolPolicies = state3.ui.toolSettings;
    const policies = await evaluateToolPolicies(
      dispatch,
      extra.ideMessenger,
      activeTools,
      generatedCalls3,
      toolPolicies,
      {
        autoRunCommands: state3.ui.autoRunCommands,
        dangerousCommands: state3.ui.dangerousCommands,
        autoRunMcpTools: state3.ui.autoRunMcpTools,
      },
    );
    const autoApprovedPolicies = policies.filter(
      ({ policy }) => policy === "allowedWithoutPermission",
    );
    const needsApprovalPolicies = policies.filter(
      ({ policy }) => policy === "allowedWithPermission",
    );

    // 4. Execute remaining tool calls
    if (originalToolCalls.length === 0) {
      const loop = getState().session.toolLoop ?? EMPTY_TOOL_LOOP;
      const spoken = currentReplyWithoutTools(getState().session.history);
      const canNudge =
        activeTools.length > 0 &&
        state.session.mode === "agent" &&
        spoken.trim().length > 0 &&
        !loop.phraseNudgeSent &&
        shouldNudgeForMissingToolCall(spoken);
      if (canNudge) {
        dispatch(clearStalledAssistantReply());
        dispatch(setToolLoop({ ...loop, phraseNudgeSent: true }));
        dispatch(appendLoopResume(PHRASE_LOOP_RESUME));
        unwrapResult(await dispatch(streamNormalInput({ depth: depth + 1 })));
      } else {
        dispatch(setInactive());
      }
    } else if (needsApprovalPolicies.length > 0) {
      const builtInReadonlyAutoApproved = autoApprovedPolicies.filter(
        ({ toolCallState }) =>
          toolCallState.tool?.group === BUILT_IN_GROUP_NAME &&
          toolCallState.tool?.readonly,
      );

      if (builtInReadonlyAutoApproved.length > 0) {
        const state4 = getState();
        if (streamStopped()) {
          return;
        }
        await executeAutoTools(
          builtInReadonlyAutoApproved.map(({ toolCallState }) => toolCallState),
        );
      }

      dispatch(setInactive());
    } else {
      // auto stream cases increase thunk depth by 1 for debugging
      const state4 = getState();
      const generatedCalls4 = selectPendingToolCalls(state4);
      if (streamStopped()) {
        return;
      }
      if (generatedCalls4.length > 0) {
        await executeAutoTools(generatedCalls4);
      } else {
        const anchor = originalToolCalls[originalToolCalls.length - 1];
        unwrapResult(
          await dispatch(
            streamResponseAfterToolCall({
              toolCallId: anchor.toolCallId,
              depth: depth + 1,
            }),
          ),
        );
      }
    }
  },
);
