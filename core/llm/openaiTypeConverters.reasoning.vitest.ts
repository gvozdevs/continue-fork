import { describe, expect, it } from "vitest";
import {
  fromChatCompletionChunk,
  fromChatResponse,
  toChatBody,
} from "./openaiTypeConverters";

describe("reasoning_content", () => {
  const reasoning = "Мы должны ответить на вопрос пользователя.";
  const answer = "Я не могу напрямую выполнить команды.";

  it("splits a full chat.completion into thinking and the answer", () => {
    const messages = fromChatCompletionChunk({
      id: "chatcmpl-1",
      created: 1790169308,
      model: "DeepSeek-V4-Flash-0731",
      object: "chat.completion",
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            role: "assistant",
            content: answer,
            reasoning_content: reasoning,
          },
        },
      ],
    } as any);

    expect(messages).toEqual([
      { role: "thinking", content: reasoning },
      { role: "assistant", content: answer },
    ]);
  });

  it("keeps reasoning when a stream delta also has content", () => {
    const messages = fromChatCompletionChunk({
      id: "chatcmpl-1",
      created: 1790169308,
      model: "DeepSeek-V4-Flash-0731",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: answer,
            reasoning_content: reasoning,
          },
        },
      ],
    } as any);

    expect(messages.map((message) => message.role)).toEqual([
      "thinking",
      "assistant",
    ]);
    expect(messages[0]).toMatchObject({ role: "thinking", content: reasoning });
    expect(messages[1]).toMatchObject({ role: "assistant", content: answer });
  });

  it("returns the same assistant text for a content-only delta", () => {
    expect(
      fromChatCompletionChunk({
        id: "chatcmpl-1",
        created: 1,
        model: "m",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content: "hello" } }],
      } as any),
    ).toEqual([{ role: "assistant", content: "hello" }]);
  });

  it("returns tool call deltas and ignores an empty chunk", () => {
    expect(
      fromChatCompletionChunk({
        id: "chatcmpl-1",
        created: 1,
        model: "m",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: '{"filepath":' },
                },
              ],
            },
          },
        ],
      } as any),
    ).toEqual([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"filepath":' },
          },
        ],
      },
    ]);

    expect(
      fromChatCompletionChunk({
        id: "chatcmpl-1",
        created: 1,
        model: "m",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      } as any),
    ).toEqual([]);
    expect(
      fromChatCompletionChunk({
        id: "chatcmpl-1",
        created: 1,
        model: "m",
        object: "chat.completion.chunk",
        choices: [],
      } as any),
    ).toEqual([]);
  });

  it("keeps answer text when a delta also carries tool calls", () => {
    const messages = fromChatCompletionChunk({
      id: "chatcmpl-1",
      created: 1,
      model: "m",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: {
            content: "hello",
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "read_file", arguments: "{}" },
              },
            ],
          },
        },
      ],
    } as any);

    expect(messages).toEqual([{ role: "assistant", content: "hello" }]);
  });

  it("still reads a reasoning-only delta", () => {
    const messages = fromChatResponse({
      id: "chatcmpl-1",
      created: 1,
      model: "DeepSeek-V4-Flash-0731",
      object: "chat.completion",
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            role: "assistant",
            content: answer,
            reasoning_content: reasoning,
          },
        },
      ],
    } as any);

    expect(messages[0].role).toBe("thinking");
    expect(fromChatCompletionChunk({
      id: "chatcmpl-1",
      created: 1,
      model: "m",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: { reasoning_content: reasoning },
        },
      ],
    } as any)).toEqual([
      expect.objectContaining({ role: "thinking", content: reasoning }),
    ]);
  });
});

describe("reasoning_effort", () => {
  it("adds reasoning_effort to the chat body when set", () => {
    const body = toChatBody(
      [{ role: "user", content: "hi" }],
      { model: "DeepSeek-V4-Flash-0731", reasoningEffort: "high" } as any,
    );
    expect((body as { reasoning_effort?: string }).reasoning_effort).toBe(
      "high",
    );
  });

  it("omits reasoning_effort when it is not set", () => {
    const body = toChatBody(
      [{ role: "user", content: "hi" }],
      { model: "DeepSeek-V4-Flash-0731" } as any,
    );
    expect(
      (body as { reasoning_effort?: string }).reasoning_effort,
    ).toBeUndefined();
  });
});
