import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const askQuestionTool: Tool = {
  type: "function",
  displayTitle: "Ask Question",
  wouldLikeTo: "ask a question",
  isCurrently: "waiting for an answer",
  hasAlready: "asked a question",
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.AskQuestion,
    description: `Ask the user one question only when the files and tool results you already have cannot settle a contract choice.
Guidelines:
- First check the codebase with read_file or grep_search. Ask only when that does not answer it.
- Do not ask for permission to start work the user already requested. Do not ask whether to implement the whole task.
- Ask one question per call. Pass two or more options when there are real choices, or an empty options array for a free-form answer.
- DO NOT supply "other" or "none of the above" or similar as an option. The user can always type a free-form answer.
- Do not repeat the question in the reply text; the tool shows it.`,
    parameters: {
      type: "object",
      required: ["question", "options"],
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user",
        },
        options: {
          anyOf: [
            { type: "array", items: { type: "string" } },
            { type: "string" },
            { type: "null" },
          ],
          description:
            "The list of choices. Leave as an empty array if the user should provide a free-form answer.",
        },
        defaultAnswer: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description:
            "Default answer if the user submits without typing. Omit when there is no default.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `To ask the user one clarifying question, use the ${BuiltInToolNames.AskQuestion} tool. Include options when there are real choices, or an empty options array for a free-form answer. For example:`,
    exampleArgs: [
      ["question", "Which logger should the new handler use?"],
      ["options", '["zap", "slog"]'],
    ],
  },
};
