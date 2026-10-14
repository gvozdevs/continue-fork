import { ToolPolicy } from "@continuedev/terminal-security";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RuleWithSource, Tool } from "core";
import { BUILT_IN_GROUP_NAME } from "core/tools/builtIn";
import {
  defaultOnboardingCardState,
  OnboardingCardState,
} from "../../components/OnboardingCard";
import { getLocalStorage, LocalStorageKey } from "../../util/localStorage";
import {
  DEFAULT_AUTO_RUN_COMMANDS,
  DEFAULT_DANGEROUS_COMMANDS,
} from "../../util/toolCallState";

export type RulePolicy = "on" | "off";

export type ToolGroupPolicy = "include" | "exclude";

export type ToolPolicies = { [toolName: string]: ToolPolicy };
export type RulePolicies = { [ruleName: string]: RulePolicy };
export type ToolGroupPolicies = { [toolGroupName: string]: ToolGroupPolicy };
export type ReasoningSettings = { [modelTitle: string]: boolean };

type UIState = {
  showDialog: boolean;
  dialogMessage: JSX.Element | undefined;
  onboardingCard: OnboardingCardState;
  isExploreDialogOpen: boolean;
  hasDismissedExploreDialog: boolean;
  shouldAddFileForEditing: boolean;
  toolSettings: ToolPolicies;
  toolGroupSettings: ToolGroupPolicies;
  ruleSettings: RulePolicies;
  reasoningSettings: ReasoningSettings;
  ttsActive: boolean;
  /** Base command names that auto-run for run_terminal_command (e.g. "ls", "git"). */
  autoRunCommands: string[];
  /** Base command names that always require confirmation (e.g. "sudo", "rm"). */
  dangerousCommands: string[];
  autoRunMcpTools: boolean;
};

export const DEFAULT_TOOL_SETTING: ToolPolicy = "allowedWithPermission";
export const DEFAULT_RULE_SETTING: RulePolicy = "on";
export const DEFAULT_UI_SLICE: UIState = {
  showDialog: false,
  dialogMessage: undefined,
  onboardingCard: defaultOnboardingCardState,
  isExploreDialogOpen:
    getLocalStorage(LocalStorageKey.IsExploreDialogOpen) ?? false,
  hasDismissedExploreDialog:
    getLocalStorage(LocalStorageKey.HasDismissedExploreDialog) ?? false,
  shouldAddFileForEditing: false,
  ttsActive: false,
  toolSettings: {},
  toolGroupSettings: {
    [BUILT_IN_GROUP_NAME]: "include",
  },
  ruleSettings: {},
  reasoningSettings: {},
  autoRunCommands: [...DEFAULT_AUTO_RUN_COMMANDS],
  dangerousCommands: [...DEFAULT_DANGEROUS_COMMANDS],
  autoRunMcpTools: false,
};

function normalizeCommandName(command: string): string {
  return command.trim().toLowerCase();
}

export const uiSlice = createSlice({
  name: "ui",
  initialState: DEFAULT_UI_SLICE,
  reducers: {
    setOnboardingCard: (
      state,
      action: PayloadAction<Partial<OnboardingCardState>>,
    ) => {
      state.onboardingCard = { ...state.onboardingCard, ...action.payload };
    },
    setDialogMessage: (
      state,
      action: PayloadAction<UIState["dialogMessage"]>,
    ) => {
      state.dialogMessage = action.payload;
    },
    setShowDialog: (state, action: PayloadAction<UIState["showDialog"]>) => {
      state.showDialog = action.payload;
    },
    setIsExploreDialogOpen: (
      state,
      action: PayloadAction<UIState[LocalStorageKey.IsExploreDialogOpen]>,
    ) => {
      state.isExploreDialogOpen = action.payload;
    },
    // Tools
    addTool: (state, action: PayloadAction<Tool>) => {
      state.toolSettings[action.payload.function.name] =
        action.payload.defaultToolPolicy ?? DEFAULT_TOOL_SETTING;
    },
    setToolPolicy: (
      state,
      action: PayloadAction<{
        toolName: string;
        policy: ToolPolicy;
      }>,
    ) => {
      state.toolSettings[action.payload.toolName] = action.payload.policy;
    },
    clearToolPolicy: (state, action: PayloadAction<string>) => {
      delete state.toolSettings[action.payload];
    },
    toggleToolSetting: (state, action: PayloadAction<string>) => {
      const setting = state.toolSettings[action.payload];

      switch (setting) {
        case "allowedWithPermission":
          state.toolSettings[action.payload] = "allowedWithoutPermission";
          break;
        case "allowedWithoutPermission":
          state.toolSettings[action.payload] = "disabled";
          break;
        case "disabled":
          state.toolSettings[action.payload] = "allowedWithPermission";
          break;
        default:
          state.toolSettings[action.payload] = DEFAULT_TOOL_SETTING;
          break;
      }
    },
    toggleToolGroupSetting: (state, action: PayloadAction<string>) => {
      const setting = state.toolGroupSettings[action.payload] ?? "include";

      if (setting === "include") {
        state.toolGroupSettings[action.payload] = "exclude";
      } else {
        state.toolGroupSettings[action.payload] = "include";
      }
    },
    // Rules
    addRule: (state, action: PayloadAction<RuleWithSource>) => {
      state.ruleSettings[action.payload.name!] = DEFAULT_RULE_SETTING;
    },
    toggleRuleSetting: (state, action: PayloadAction<string>) => {
      const setting = state.ruleSettings[action.payload];

      switch (setting) {
        case "on":
          state.ruleSettings[action.payload] = "off";
          break;
        case "off":
          state.ruleSettings[action.payload] = "on";
          break;
        default:
          state.ruleSettings[action.payload] = DEFAULT_RULE_SETTING;
          break;
      }
    },
    setTTSActive: (state, { payload }: PayloadAction<boolean>) => {
      state.ttsActive = payload;
    },
    setReasoningSetting: (
      state,
      action: PayloadAction<{ modelTitle: string; enabled: boolean }>,
    ) => {
      state.reasoningSettings[action.payload.modelTitle] =
        action.payload.enabled;
    },
    setAutoRunCommands: (state, action: PayloadAction<string[]>) => {
      const seen = new Set<string>();
      const next: string[] = [];
      for (const entry of action.payload) {
        const normalized = normalizeCommandName(entry);
        if (!normalized || seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        next.push(normalized);
      }
      state.autoRunCommands = next;
      // Keep lists mutually exclusive.
      state.dangerousCommands = state.dangerousCommands.filter(
        (command) => !seen.has(command),
      );
    },
    addAutoRunCommand: (state, action: PayloadAction<string>) => {
      const normalized = normalizeCommandName(action.payload);
      if (!normalized) {
        return;
      }
      state.dangerousCommands = state.dangerousCommands.filter(
        (command) => command !== normalized,
      );
      if (!state.autoRunCommands.includes(normalized)) {
        state.autoRunCommands.push(normalized);
      }
    },
    removeAutoRunCommand: (state, action: PayloadAction<string>) => {
      const normalized = normalizeCommandName(action.payload);
      state.autoRunCommands = state.autoRunCommands.filter(
        (command) => command !== normalized,
      );
    },
    setDangerousCommands: (state, action: PayloadAction<string[]>) => {
      const seen = new Set<string>();
      const next: string[] = [];
      for (const entry of action.payload) {
        const normalized = normalizeCommandName(entry);
        if (!normalized || seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        next.push(normalized);
      }
      state.dangerousCommands = next;
      state.autoRunCommands = state.autoRunCommands.filter(
        (command) => !seen.has(command),
      );
    },
    addDangerousCommand: (state, action: PayloadAction<string>) => {
      const normalized = normalizeCommandName(action.payload);
      if (!normalized) {
        return;
      }
      state.autoRunCommands = state.autoRunCommands.filter(
        (command) => command !== normalized,
      );
      if (!state.dangerousCommands.includes(normalized)) {
        state.dangerousCommands.push(normalized);
      }
    },
    removeDangerousCommand: (state, action: PayloadAction<string>) => {
      const normalized = normalizeCommandName(action.payload);
      state.dangerousCommands = state.dangerousCommands.filter(
        (command) => command !== normalized,
      );
    },
    /**
     * Execute and remember: promote a base command to auto-run and drop it
     * from the dangerous list if present.
     */
    rememberAutoRunCommand: (state, action: PayloadAction<string>) => {
      const normalized = normalizeCommandName(action.payload);
      if (!normalized) {
        return;
      }
      state.dangerousCommands = state.dangerousCommands.filter(
        (command) => command !== normalized,
      );
      if (!state.autoRunCommands.includes(normalized)) {
        state.autoRunCommands.push(normalized);
      }
    },
    setAutoRunMcpTools: (state, action: PayloadAction<boolean>) => {
      state.autoRunMcpTools = action.payload;
    },
  },
});

export const {
  setOnboardingCard,
  setDialogMessage,
  setShowDialog,
  setIsExploreDialogOpen,
  toggleToolSetting,
  setToolPolicy,
  clearToolPolicy,
  toggleToolGroupSetting,
  addTool,
  addRule,
  toggleRuleSetting,
  setTTSActive,
  setReasoningSetting,
  setAutoRunCommands,
  addAutoRunCommand,
  removeAutoRunCommand,
  setDangerousCommands,
  addDangerousCommand,
  removeDangerousCommand,
  rememberAutoRunCommand,
  setAutoRunMcpTools,
} = uiSlice.actions;

export default uiSlice.reducer;
