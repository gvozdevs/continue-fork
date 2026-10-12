import { expect, test } from "vitest";
import { BuiltInToolNames } from "./builtIn";
import {
  getBaseToolDefinitions,
  getConfigDependentToolDefinitions,
} from "./index";

async function toolNames(modelName: string): Promise<string[]> {
  const tools = await getConfigDependentToolDefinitions({
    rules: [],
    enableExperimentalTools: false,
    isRemote: false,
    modelName,
    ide: {} as any,
  });
  return tools.map((tool) => tool.function.name);
}

test("searchWeb tool is always available", async () => {
  const tools = await getConfigDependentToolDefinitions({
    rules: [],
    enableExperimentalTools: false,
    isRemote: false,
    modelName: "",
    ide: {} as any,
  });

  const searchWebTool = tools.find(
    (tool) => tool.function.name === BuiltInToolNames.SearchWeb,
  );
  expect(searchWebTool).toBeDefined();
  expect(searchWebTool?.displayTitle).toBe("Search Web");
});

test("the base set offers read_file and not the current-file reader", () => {
  const names = getBaseToolDefinitions().map((tool) => tool.function.name);
  expect(names).toContain(BuiltInToolNames.ReadFile);
  expect(names).toContain(BuiltInToolNames.AskQuestion);
  expect(names).toContain(BuiltInToolNames.FileGlobSearch);
  expect(names).toContain(BuiltInToolNames.LSTool);
  expect(names).not.toContain(BuiltInToolNames.ReadCurrentlyOpenFile);
  expect(names).not.toContain(BuiltInToolNames.ViewDiff);
  expect(names).not.toContain(BuiltInToolNames.CreateNewFile);
});

test("a non-recommended model receives one edit tool", async () => {
  const names = await toolNames("DeepSeek-V4-Flash-0731");
  expect(names).toContain(BuiltInToolNames.SingleFindAndReplace);
  expect(names).not.toContain(BuiltInToolNames.EditExistingFile);
  expect(names).not.toContain(BuiltInToolNames.MultiEdit);
});

test("read_skill is not offered when there are no skills", async () => {
  const names = await toolNames("DeepSeek-V4-Flash-0731");
  expect(names).not.toContain(BuiltInToolNames.ReadSkill);
});

test("a recommended model receives multi_edit only", async () => {
  const names = await toolNames("deepseek-reasoner");
  expect(names).toContain(BuiltInToolNames.MultiEdit);
  expect(names).not.toContain(BuiltInToolNames.EditExistingFile);
  expect(names).not.toContain(BuiltInToolNames.SingleFindAndReplace);
});
