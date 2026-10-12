import { describe, expect, it } from "vitest";
import {
  commandsFromArgs,
  prepareWindowsPowerShellCommand,
  rewriteUnquotedShellOperators,
  WINDOWS_UTF8_PREFIX,
} from "./windowsShell";

describe("windowsShell", () => {
  it("rewrites unquoted && and || to semicolons", () => {
    expect(rewriteUnquotedShellOperators("ls -la docs/ && git status")).toBe(
      "ls -la docs/ ; git status",
    );
    expect(rewriteUnquotedShellOperators("build || echo fail")).toBe(
      "build ; echo fail",
    );
  });

  it("leaves operators inside quotes", () => {
    expect(
      rewriteUnquotedShellOperators('echo "a && b" && echo done'),
    ).toBe('echo "a && b" ; echo done');
  });

  it("prefixes UTF-8 output encoding for PowerShell", () => {
    const prepared = prepareWindowsPowerShellCommand("Get-ChildItem docs");
    expect(prepared.startsWith(WINDOWS_UTF8_PREFIX)).toBe(true);
    expect(prepared).toContain("Get-ChildItem docs");
  });

  it("accepts a commands array or a single command", () => {
    expect(commandsFromArgs({ command: "git status" })).toEqual(["git status"]);
    expect(
      commandsFromArgs({ commands: ["git status", "git diff"] }),
    ).toEqual(["git status", "git diff"]);
  });
});
