import { readTargetsFromArgs } from "./definitions/readFile";

export const TOOL_LOOP_SOFT_THRESHOLD = 3;
export const TOOL_LOOP_HARD_THRESHOLD = 5;
export const FILE_CYCLE_WINDOW = 6;
export const TEXT_REPEAT_THRESHOLD = 3;
export const STREAM_PHRASE_ABORT_THRESHOLD = 5;
export const PHRASE_CYCLE_MAX = 10;

export const TOOL_LOOP_WARNING =
  "LOOP_DETECTED: This exact tool call was already executed with the same arguments and the result did not change. Do not call it again. Use a different tool or different arguments, or finish with the information you already have.";

export const TOOL_LOOP_STOP =
  "Stopped: the same tool call was repeated with the same arguments. The turn ended so the model is not asked to retry it.";

export const TOOL_CYCLE_STOP =
  "Stopped: the same files were read and updated in a circle without a change. The turn ended so the model is not asked to retry.";

export const TEXT_LOOP_STOP =
  "Stopped: the same reply was repeated. The turn ended so the model is not asked to continue it.";

export const INTENT_LOOP_STOP =
  "Stopped: the next step was described without a tool call. The turn ended so the model is not asked to continue it.";

export const INTENT_NARRATION_THRESHOLD = 1;

const READ_TOOLS = new Set(["read_file", "read_file_range"]);
const WRITE_TOOLS = new Set([
  "edit_existing_file",
  "single_find_and_replace",
  "multi_edit",
  "create_new_file",
]);

export interface ToolRoundRecord {
  files: string[];
  reads: string[];
  writes: string[];
  /** Last successful edit arguments per file, keyed by normalized path. */
  editSignature: Record<string, string>;
  changed: boolean | null;
}

export interface ToolLoopState {
  signature: string | null;
  consecutive: number;
  lastOutput: string | null;
  texts: string[];
  recent: ToolRoundRecord[];
  fileOutput: Record<string, string>;
  phraseNudgeSent: boolean;
}

export const EMPTY_TOOL_LOOP: ToolLoopState = {
  signature: null,
  consecutive: 0,
  lastOutput: null,
  texts: [],
  recent: [],
  fileOutput: {},
  phraseNudgeSent: false,
};

export interface AgentProgress {
  state: ToolLoopState;
  action: "continue" | "warn" | "stop";
  notice?: string;
}

export function toolCallSignature(name: string, args: string): string {
  const trimmed = args.trim();
  if (!trimmed) {
    return `${name}\n{}`;
  }
  try {
    return `${name}\n${JSON.stringify(JSON.parse(trimmed))}`;
  } catch {
    return `${name}\n${trimmed}`;
  }
}

export function toolBatchSignature(
  calls: { name: string; arguments: string }[],
): string {
  return calls
    .map((call) => toolCallSignature(call.name, call.arguments))
    .sort()
    .join("\n---\n");
}

export function noteToolBatch(
  state: ToolLoopState,
  signature: string,
): { state: ToolLoopState; action: "continue" | "warn" | "stop" } {
  const consecutive = state.signature === signature ? state.consecutive + 1 : 1;
  const next: ToolLoopState = {
    ...state,
    signature,
    consecutive,
    lastOutput: state.signature === signature ? state.lastOutput : null,
  };
  if (consecutive >= TOOL_LOOP_HARD_THRESHOLD) {
    return { state: next, action: "stop" };
  }
  if (consecutive === TOOL_LOOP_SOFT_THRESHOLD) {
    return { state: next, action: "warn" };
  }
  return { state: next, action: "continue" };
}

export function noteToolBatchOutcome(
  state: ToolLoopState,
  outcome: { ok: boolean; output: string },
): ToolLoopState {
  let next = state;
  if (outcome.ok) {
    // A finished tool call earns another nudge if the next reply only narrates.
    if (state.lastOutput !== null && state.lastOutput !== outcome.output) {
      next = {
        ...state,
        phraseNudgeSent: false,
        consecutive: 1,
        lastOutput: outcome.output,
      };
    } else {
      next = {
        ...state,
        phraseNudgeSent: false,
        lastOutput: outcome.output,
      };
    }
  }
  if (next.recent.length === 0) {
    return next;
  }
  const recent = next.recent.slice();
  const last: ToolRoundRecord = { ...recent[recent.length - 1] };
  if (last.writes.length === 0) {
    last.changed = outcome.ok;
    recent[recent.length - 1] = last;
    return { ...next, recent };
  }
  const prior = last.writes
    .map((file) => next.fileOutput[file] ?? "")
    .join("\n---\n");
  const current = last.writes
    .map((file) => last.editSignature[file] ?? "")
    .join("\n---\n");
  // The tool status line is the same for every successful edit of a file.
  // Progress is a different edit payload, or the first successful write.
  const changed = outcome.ok && (prior === "" || prior !== current);
  const fileOutput = { ...next.fileOutput };
  if (outcome.ok) {
    for (const file of last.writes) {
      fileOutput[file] = last.editSignature[file] ?? "";
    }
  }
  last.changed = changed;
  recent[recent.length - 1] = last;
  return { ...next, recent, fileOutput };
}

function parseToolArgs(args: string): Record<string, unknown> | undefined {
  const trimmed = args.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function filePathsFromToolArg(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => normalizeFilePath(item))
    .filter((item): item is string => !!item);
}

function normalizeFilePath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function normalizeAssistantText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export const LOOP_RESUME_INSTRUCTION =
  "Continue the task from the last step. Reply in the same language as the user.";

export const PHRASE_LOOP_RESUME =
  "Call the tool now. Do not describe the call in prose. Reply in the same language as the user.";

export function turnSpokenText(
  history: {
    message: { role: string; content: unknown };
    reasoning?: { text?: string };
  }[],
): string {
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user") {
      start = i + 1;
      break;
    }
  }
  const parts: string[] = [];
  for (const item of history.slice(start)) {
    const role = item.message.role;
    if (role !== "assistant" && role !== "thinking") {
      continue;
    }
    if (item.reasoning?.text) {
      parts.push(item.reasoning.text);
    }
    if (
      typeof item.message.content === "string" &&
      item.message.content.trim()
    ) {
      parts.push(item.message.content);
    }
  }
  return parts.join("\n");
}

export function assistantSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => normalizeAssistantText(part).replace(/[.!?]+$/g, ""))
    .filter((part) => part.length >= 8);
}

const INTENT_SENTENCE =
  /^(?:now\s+)?(?:let me (?!know\b)|i'll |i will |давайте |давай )/;
const STALL_SENTENCE =
  /extremely large|enormous scope|complex task|comprehensive understanding|let me continue reading|let me read the remaining|remaining section|задача огромн|очень больш|огромн/;

export function isIntentNarration(text: string): boolean {
  let intentCount = 0;
  for (const sentence of assistantSentences(text)) {
    if (STALL_SENTENCE.test(sentence)) {
      return true;
    }
    if (!INTENT_SENTENCE.test(sentence)) {
      continue;
    }
    intentCount += 1;
    if (intentCount >= INTENT_NARRATION_THRESHOLD) {
      return true;
    }
  }
  return false;
}

export function currentReplyWithoutTools(
  history: {
    message: { role: string; content: unknown };
    reasoning?: { text?: string };
    toolCallStates?: unknown[];
  }[],
): string {
  const last = history[history.length - 1];
  if (!last) {
    return "";
  }
  const role = last.message.role;
  if (role !== "assistant" && role !== "thinking") {
    return "";
  }
  if (last.toolCallStates?.length) {
    return "";
  }
  const parts: string[] = [];
  if (last.reasoning?.text) {
    parts.push(last.reasoning.text);
  }
  if (typeof last.message.content === "string" && last.message.content.trim()) {
    parts.push(last.message.content);
  }
  return parts.join("\n");
}

export function isRepeatedPhrase(
  text: string,
  threshold: number = TEXT_REPEAT_THRESHOLD,
): boolean {
  const sentences = assistantSentences(text);
  for (let size = 1; size <= PHRASE_CYCLE_MAX; size++) {
    const need = size * threshold;
    if (sentences.length < need) {
      continue;
    }
    const tail = sentences.slice(-need);
    const repeats = tail.every(
      (sentence, index) => sentence === tail[index % size],
    );
    if (repeats) {
      return true;
    }
  }
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const key = sentence;
    const count = (counts.get(key) ?? 0) + 1;
    if (count >= threshold) {
      return true;
    }
    counts.set(key, count);
  }
  return false;
}

export function shouldNudgeForMissingToolCall(text: string): boolean {
  return isRepeatedPhrase(text) || isIntentNarration(text);
}

export function shouldAbortStreamingPhraseLoop(
  history: {
    message: { role: string; content: unknown };
    reasoning?: { text?: string };
    toolCallStates?: unknown[];
  }[],
): boolean {
  const last = history[history.length - 1];
  if (!last || last.toolCallStates?.length) {
    return false;
  }
  const role = last.message.role;
  if (role !== "assistant" && role !== "thinking") {
    return false;
  }
  const text = currentReplyWithoutTools(history);
  if (!text.trim()) {
    return false;
  }
  return isRepeatedPhrase(text, STREAM_PHRASE_ABORT_THRESHOLD);
}

function classifyRound(
  calls: { name: string; arguments: string }[],
): ToolRoundRecord {
  const reads: string[] = [];
  const writes: string[] = [];
  const files: string[] = [];
  const editSignature: Record<string, string> = {};
  for (const call of calls) {
    const args = parseToolArgs(call.arguments);
    if (READ_TOOLS.has(call.name)) {
      const targets = readTargetsFromArgs(args ?? {});
      for (const target of targets) {
        const filepath = normalizeFilePath(target.path);
        if (!filepath) {
          continue;
        }
        files.push(filepath);
        reads.push(
          `${filepath}#${target.start_line ?? ""}#${target.end_line ?? ""}`,
        );
      }
      continue;
    }
    const filepaths = filePathsFromToolArg(args?.filepath);
    const signature = WRITE_TOOLS.has(call.name)
      ? toolCallSignature(call.name, call.arguments)
      : "";
    for (const filepath of filepaths) {
      files.push(filepath);
      if (!signature) {
        continue;
      }
      writes.push(filepath);
      editSignature[filepath] = editSignature[filepath]
        ? `${editSignature[filepath]}\n---\n${signature}`
        : signature;
    }
  }
  return {
    files: [...new Set(files)],
    reads,
    writes,
    editSignature,
    changed: null,
  };
}

function isFileCycle(window: ToolRoundRecord[]): boolean {
  if (window.length < FILE_CYCLE_WINDOW) {
    return false;
  }
  const last = window.slice(-FILE_CYCLE_WINDOW);
  const files = new Set(last.flatMap((batch) => batch.files));
  if (files.size < 1 || files.size > 2) {
    return false;
  }
  if (last.some((batch) => batch.files.length === 0)) {
    return false;
  }
  if (last.some((batch) => batch.files.some((file) => !files.has(file)))) {
    return false;
  }
  const hasRead = last.some((batch) => batch.reads.length > 0);
  const hasWrite = last.some((batch) => batch.writes.length > 0);
  if (!hasRead || !hasWrite) {
    return false;
  }
  const completedWrites = last.filter(
    (batch) => batch.writes.length > 0 && batch.changed !== null,
  );
  const latestWrite = completedWrites[completedWrites.length - 1];
  return latestWrite?.changed === false;
}

export function noteAgentProgress(
  state: ToolLoopState,
  round: {
    calls: { name: string; arguments: string }[];
    assistantText: string;
  },
): AgentProgress {
  const identical = noteToolBatch(state, toolBatchSignature(round.calls));
  let next: ToolLoopState = identical.state;
  const classified = classifyRound(round.calls);

  if (identical.action === "stop") {
    return { state: next, action: "stop", notice: TOOL_LOOP_STOP };
  }
  if (isFileCycle([...next.recent, classified])) {
    return { state: next, action: "stop", notice: TOOL_CYCLE_STOP };
  }

  next = {
    ...next,
    recent: [...next.recent, classified].slice(-FILE_CYCLE_WINDOW),
  };
  if (identical.action === "warn") {
    return { state: next, action: "warn", notice: TOOL_LOOP_WARNING };
  }
  return { state: next, action: "continue" };
}
