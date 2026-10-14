import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_SYSTEM_MESSAGE_TEMPLATE,
  DEFAULT_PLAN_SYSTEM_MESSAGE_TEMPLATE,
  buildAgentSystemMessage,
  buildPlanSystemMessage,
  renderSystemMessageTemplate,
} from "./defaultSystemMessages";

describe("renderSystemMessageTemplate", () => {
  it("substitutes known placeholders", () => {
    const out = renderSystemMessageTemplate(
      "p={{platform}} s={{shell}} f={{file_tool}} a={{file_tool_array}} q={{ask_question}} l={{language}}{{language_section}}",
      {
        platform: "darwin",
        shell: "/bin/zsh",
        fileTool: "multi_edit",
        date: "2026-01-02",
        cwd: "/repo",
        language: "Russian",
      },
    );
    expect(out).toContain(
      "p=darwin s=/bin/zsh f=multi_edit a=edits q=ask_question l=Russian",
    );
    expect(out).toContain("# Language");
  });

  it("injects Claude-style language section when language is set", () => {
    const withLang = renderSystemMessageTemplate(
      "intro\n\n{{language_section}}# Next",
      { language: "Russian" },
    );
    expect(withLang).toContain("# Language");
    expect(withLang).toContain("Always respond in Russian.");
    expect(withLang).toContain("Technical terms and code identifiers");

    const without = renderSystemMessageTemplate(
      "intro\n\n{{language_section}}# Next",
      { language: "" },
    );
    expect(without).toBe("intro\n\n# Next");
    expect(without).not.toContain("# Language");
  });

  it("appends language section when template omits the placeholder", () => {
    const out = renderSystemMessageTemplate("Hello only.", {
      language: "English",
    });
    expect(out).toContain("Hello only.");
    expect(out).toContain("# Language");
    expect(out).toContain("Always respond in English.");
  });

  it("leaves unknown placeholders intact", () => {
    expect(renderSystemMessageTemplate("x={{unknown_thing}}")).toBe(
      "x={{unknown_thing}}",
    );
  });

  it("does not rewrite {{ spaced }} edit placeholders", () => {
    expect(renderSystemMessageTemplate("{{ modified code here }}")).toBe(
      "{{ modified code here }}",
    );
  });
});

describe("default templates", () => {
  it("agent template has no vendor branding and names Continue tools", () => {
    const msg = buildAgentSystemMessage("single_find_and_replace", undefined, {
      cwd: "/tmp/ws",
      date: "2026-10-14",
      platform: "linux",
      arch: "arm64",
      shell: "/bin/bash",
    });
    expect(msg.toLowerCase()).not.toContain("claude");
    expect(msg.toLowerCase()).not.toContain("anthropic");
    expect(msg).toContain("read_file");
    expect(msg).toContain("run_terminal_command");
    expect(msg).toContain("Working directory: /tmp/ws");
    expect(msg).toContain("Today's date: 2026-10-14");
    expect(DEFAULT_AGENT_SYSTEM_MESSAGE_TEMPLATE).toContain("{{environment}}");
  });

  it("plan template stays read-only oriented", () => {
    const msg = buildPlanSystemMessage();
    expect(msg).toContain("MUST NOT make edits");
    expect(msg).toContain("read_file");
    expect(msg.toLowerCase()).not.toContain("claude");
    expect(DEFAULT_PLAN_SYSTEM_MESSAGE_TEMPLATE).toContain("{{ask_question}}");
  });
});
