import { ModelDescription, Tool } from "core";
import {
  DEFAULT_AGENT_SYSTEM_MESSAGE_TEMPLATE,
  DEFAULT_CHAT_SYSTEM_MESSAGE,
  DEFAULT_PLAN_SYSTEM_MESSAGE_TEMPLATE,
  buildAgentSystemMessage,
  buildPlanSystemMessage,
} from "core/llm/defaultSystemMessages";
import { BuiltInToolNames } from "core/tools/builtIn";
import { getBaseSystemMessage, NO_TOOL_WARNING } from "./getBaseSystemMessage";

test("the default agent message names the file tool that is active", () => {
  const multiEdit = {
    function: { name: BuiltInToolNames.MultiEdit, parameters: {} },
  } as Tool;
  const withMultiEdit = getBaseSystemMessage("agent", {} as ModelDescription, [
    multiEdit,
  ]);
  expect(withMultiEdit).toContain("Use multi_edit both to create");
  expect(withMultiEdit).toContain("in the edits array");
  expect(withMultiEdit).not.toContain("single_find_and_replace");
  expect(withMultiEdit).not.toContain("{{file_tool}}");

  const defaultRendered = buildAgentSystemMessage("single_find_and_replace");
  expect(defaultRendered).toContain(
    "Use single_find_and_replace both to create",
  );
  expect(defaultRendered).toContain("in the replacements array");
  expect(defaultRendered).toContain("ls and file_glob_search");
  expect(defaultRendered).toContain(
    "A response with no tool call is the final answer",
  );
  expect(DEFAULT_AGENT_SYSTEM_MESSAGE_TEMPLATE).toContain("{{file_tool}}");
});

test("plan template renders Continue read-only tools and no Claude branding", () => {
  const plan = buildPlanSystemMessage();
  expect(plan).toContain("plan mode");
  expect(plan).toContain("read_file");
  expect(plan).toContain("ask_question");
  expect(plan).toMatch(/Agent mode/i);
  expect(plan.toLowerCase()).not.toContain("claude");
  expect(plan.toLowerCase()).not.toContain("anthropic");
  expect(DEFAULT_PLAN_SYSTEM_MESSAGE_TEMPLATE).toContain("{{environment}}");
});

test("getBaseSystemMessage should return the correct system message based on mode", () => {
  const mockModel = {
    baseChatSystemMessage: "Custom Chat System Message",
    basePlanSystemMessage: "Custom Plan System Message",
    baseAgentSystemMessage: "Custom Agent System Message",
  } as ModelDescription;

  const mockTool = {
    function: {
      name: "testTool",
      description: "Test tool",
      parameters: {},
    },
  } as Tool;

  // Model overrides are still run through the template renderer (no placeholders → same text)
  expect(getBaseSystemMessage("agent", mockModel, [mockTool])).toBe(
    "Custom Agent System Message",
  );

  expect(getBaseSystemMessage("plan", mockModel, [mockTool])).toBe(
    "Custom Plan System Message",
  );

  expect(getBaseSystemMessage("chat", mockModel, [mockTool])).toBe(
    "Custom Chat System Message",
  );

  const agentDefault = getBaseSystemMessage("agent", {} as ModelDescription, [
    mockTool,
  ]);
  expect(agentDefault).toContain("interactive coding agent");
  expect(agentDefault).toContain("single_find_and_replace");

  const planDefault = getBaseSystemMessage("plan", {} as ModelDescription, [
    mockTool,
  ]);
  expect(planDefault).toContain("plan mode");
  expect(planDefault).toContain("read_file");

  expect(getBaseSystemMessage("chat", {} as ModelDescription, [mockTool])).toBe(
    DEFAULT_CHAT_SYSTEM_MESSAGE,
  );
});

test("shared settings templates override built-in defaults", () => {
  const mockTool = {
    function: { name: "testTool", parameters: {} },
  } as Tool;

  const agent = getBaseSystemMessage(
    "agent",
    {} as ModelDescription,
    [mockTool],
    {
      agentSystemMessage:
        "AGENT_CUSTOM {{file_tool}} cwd={{cwd}} date={{date}}",
      cwd: "/tmp/project",
      date: "2026-10-14",
    },
  );
  expect(agent).toBe(
    "AGENT_CUSTOM single_find_and_replace cwd=/tmp/project date=2026-10-14",
  );

  const plan = getBaseSystemMessage(
    "plan",
    {} as ModelDescription,
    [mockTool],
    {
      planSystemMessage: "PLAN_CUSTOM use {{ask_question}}",
    },
  );
  expect(plan).toBe("PLAN_CUSTOM use ask_question");
});

test("user language is injected into agent, plan, and chat prompts", () => {
  const mockTool = {
    function: { name: "testTool", parameters: {} },
  } as Tool;

  const agent = getBaseSystemMessage(
    "agent",
    {} as ModelDescription,
    [mockTool],
    { language: "Russian" },
  );
  expect(agent).toContain("# Language");
  expect(agent).toContain("Always respond in Russian.");

  const plan = getBaseSystemMessage(
    "plan",
    {} as ModelDescription,
    [mockTool],
    { language: "Russian" },
  );
  expect(plan).toContain("Always respond in Russian.");

  const chat = getBaseSystemMessage(
    "chat",
    {} as ModelDescription,
    [mockTool],
    { language: "German" },
  );
  expect(chat).toContain("# Language");
  expect(chat).toContain("Always respond in German.");

  const noLang = getBaseSystemMessage("agent", {} as ModelDescription, [
    mockTool,
  ]);
  expect(noLang).not.toContain("# Language");
});

test("getBaseSystemMessage should append no-tools warning for agent/plan modes without tools", () => {
  const mockModel = {
    baseChatSystemMessage: "Custom Chat System Message",
    basePlanSystemMessage: "Custom Plan System Message",
    baseAgentSystemMessage: "Custom Agent System Message",
  } as ModelDescription;

  expect(getBaseSystemMessage("agent", mockModel, [])).toBe(
    "Custom Agent System Message" + NO_TOOL_WARNING,
  );

  expect(getBaseSystemMessage("plan", mockModel, [])).toBe(
    "Custom Plan System Message" + NO_TOOL_WARNING,
  );

  expect(getBaseSystemMessage("chat", mockModel, [])).toBe(
    "Custom Chat System Message",
  );

  expect(getBaseSystemMessage("agent", mockModel)).toBe(
    "Custom Agent System Message" + NO_TOOL_WARNING,
  );

  expect(getBaseSystemMessage("plan", mockModel)).toBe(
    "Custom Plan System Message" + NO_TOOL_WARNING,
  );
});
