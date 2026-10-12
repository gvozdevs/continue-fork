import { expect, test } from "vitest";
import { tailTerminalOutput } from "./terminalOutput";

test("short output is returned unchanged", () => {
  expect(tailTerminalOutput("ok\n", 100)).toBe("ok\n");
});

test("long output keeps the last lines and says what was removed", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
  const output = lines.join("\n");
  const result = tailTerminalOutput(output, 60);
  expect(result).toContain("line 50");
  expect(result).not.toContain("line 1\n");
  expect(result).toMatch(/^\[Terminal output was cut: the first \d+ lines/);
  const body = result.slice(result.indexOf("]\n") + 2);
  expect(body.startsWith("line ")).toBe(true);
  expect(body.length).toBeLessThanOrEqual(60);
});
