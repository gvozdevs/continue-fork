import { unwrapResult } from "@reduxjs/toolkit";
import { shouldAutoCompactContext } from "core/util/autoCompact";
import { IIdeMessenger } from "../../context/IdeMessenger";
import {
  setCompactionLoading,
  setConversationSummary,
} from "../slices/sessionSlice";
import { AppDispatch, RootState } from "../store";
import { saveCurrentSession } from "./session";

function isEmptyAssistantPlaceholder(
  item: RootState["session"]["history"][number] | undefined,
): boolean {
  if (!item || item.message.role !== "assistant") {
    return false;
  }
  const content =
    typeof item.message.content === "string" ? item.message.content.trim() : "";
  const hasToolCalls = !!item.message.toolCalls?.length;
  return !content && !hasToolCalls && !item.toolCallStates?.length;
}

/** Recent tail left verbatim. Older completed rounds fold into the summary. */
export const KEEP_RECENT_TOKENS = 20_000;
const CHARS_PER_TOKEN = 4;

function textChars(content: unknown): number {
  if (typeof content === "string") {
    return content.length;
  }
  if (!Array.isArray(content)) {
    return 0;
  }
  return content.reduce((total, part) => {
    if (
      part &&
      typeof part === "object" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      return total + part.text.length;
    }
    return total;
  }, 0);
}

function messageChars(
  item: RootState["session"]["history"][number],
): number {
  let chars = textChars(item.message.content);
  for (const contextItem of item.contextItems ?? []) {
    chars += textChars(contextItem.content);
  }
  const message = item.message;
  if (
    (message.role === "assistant" || message.role === "thinking") &&
    message.toolCalls?.length
  ) {
    for (const call of message.toolCalls) {
      const args = call.function?.arguments;
      if (typeof args === "string") {
        chars += args.length;
      }
    }
  }
  return chars;
}

/**
 * First message of the tail that stays verbatim.
 * -1 when the only older message is the original task, or the transcript
 * is too short to summarize.
 */
function recentTailStart(
  history: RootState["session"]["history"],
): number {
  if (history.length < 2) {
    return -1;
  }
  let end = history.length - 1;
  if (isEmptyAssistantPlaceholder(history[end])) {
    end -= 1;
  }
  if (end < 1) {
    return -1;
  }

  const budget = KEEP_RECENT_TOKENS * CHARS_PER_TOKEN;
  let chars = 0;
  let suffixStart = end;
  for (let i = end; i >= 0; i--) {
    suffixStart = i;
    chars += messageChars(history[i]);
    if (chars >= budget && i > 0) {
      break;
    }
  }
  while (suffixStart > 0 && history[suffixStart].message.role === "tool") {
    suffixStart -= 1;
  }
  if (suffixStart <= 0) {
    return -1;
  }
  if (suffixStart === 1 && history[0]?.message.role === "user") {
    return -1;
  }
  return suffixStart;
}

/**
 * Index of the message that will carry the summary.
 * Messages after this index stay in the next request. The original user
 * message is never the whole prefix: a long spec stays in the request.
 * The kept tail is about 20k tokens. A tool result is not split from the
 * assistant call that produced it.
 */
export function compactionIndex(
  history: RootState["session"]["history"],
): number {
  const suffixStart = recentTailStart(history);
  if (suffixStart < 0) {
    return -1;
  }
  return suffixStart - 1;
}

/**
 * Tokens in finished rounds that a summary would replace.
 * The original task and the recent tail are not included. Tool-call
 * arguments count, so a created file left in an old edit adds to this.
 */
export function staleHistoryTokens(
  history: RootState["session"]["history"],
): number {
  const suffixStart = recentTailStart(history);
  if (suffixStart < 0) {
    return 0;
  }
  const taskIndex = history.findIndex(
    (item) => item.message.role === "user" && !item.hidden,
  );
  let chars = 0;
  for (let i = 0; i < suffixStart; i++) {
    if (i === taskIndex) {
      continue;
    }
    chars += messageChars(history[i]);
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Summarize the session when context is near the CLI auto-compact threshold,
 * then keep the in-progress turn alive. Returns true when a summary was stored.
 */
export async function autoCompactHistoryIfNeeded(args: {
  dispatch: AppDispatch;
  getState: () => RootState;
  ideMessenger: IIdeMessenger;
  contextPercentage?: number;
  didPrune?: boolean;
  notEnoughContext?: boolean;
  staleTokens?: number;
  compactStaleHistory?: boolean;
  staleTokenLimit?: number;
}): Promise<boolean> {
  const {
    dispatch,
    getState,
    ideMessenger,
    contextPercentage,
    didPrune,
    notEnoughContext,
    staleTokens,
    compactStaleHistory,
    staleTokenLimit,
  } = args;

  if (
    !shouldAutoCompactContext({
      contextPercentage,
      didPrune,
      notEnoughContext,
      staleTokens,
      compactStaleHistory,
      staleTokenLimit,
    })
  ) {
    return false;
  }

  const state = getState();
  if (!state.session.isStreaming || state.session.history.length < 2) {
    return false;
  }

  const index = compactionIndex(state.session.history);
  if (index < 0) {
    return false;
  }

  dispatch(setCompactionLoading({ index, loading: true }));
  try {
    unwrapResult(
      await dispatch(
        saveCurrentSession({
          openNewSession: false,
          generateTitle: false,
        }),
      ),
    );

    if (getState().session.streamAborter.signal.aborted) {
      return false;
    }

    const result = await ideMessenger.request("conversation/compact", {
      index,
      sessionId: state.session.id,
    });
    if (result.status !== "success" || !result.content?.trim()) {
      return false;
    }

    dispatch(
      setConversationSummary({
        index,
        summary: result.content,
      }),
    );
    return true;
  } catch (error) {
    console.error("Auto-compaction failed:", error);
    return false;
  } finally {
    dispatch(setCompactionLoading({ index, loading: false }));
  }
}
