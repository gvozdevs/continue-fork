import { describe, expect, it } from "vitest";
import {
  OUTDATED_FILE_CONTENT,
  READ_RESULT_MAX_CHARS,
  shapedReadContents,
  truncateReadMiddle,
} from "./elideReadResults";

function read(id: string, filepath: string, content: string, range?: { start_line: number; end_line: number }) {
  return {
    id,
    name: "read_file",
    arguments: JSON.stringify({ filepath, ...range }),
    content,
  };
}

describe("shapedReadContents", () => {
  it("keeps different files and different windows", () => {
    const body = "line\n".repeat(40);
    const shaped = shapedReadContents([
      read("a", "a.go", body),
      read("b", "docs/fr2.md", body, { start_line: 1, end_line: 200 }),
      read("c", "docs/fr2.md", body, { start_line: 200, end_line: 400 }),
    ]);
    expect(shaped.size).toBe(0);
  });

  it("marks an older read of the same range outdated", () => {
    const shaped = shapedReadContents([
      read("old", "docs/fr2.md", "first", { start_line: 1, end_line: 200 }),
      read("new", "docs/fr2.md", "second", { start_line: 1, end_line: 200 }),
    ]);
    expect(shaped.get("old")).toBe(OUTDATED_FILE_CONTENT);
    expect(shaped.has("new")).toBe(false);
  });

  it("marks a read outdated after that file is edited", () => {
    const shaped = shapedReadContents([
      read("old", "handler.go", "package handler"),
      {
        id: "edit",
        name: "single_find_and_replace",
        arguments: JSON.stringify({ filepath: "handler.go" }),
        content: "edited",
      },
    ]);
    expect(shaped.get("old")).toBe(OUTDATED_FILE_CONTENT);
  });

  it("truncates a long read in the middle and keeps both ends", () => {
    const text = `${"HEAD".repeat(1000)}${"MID".repeat(4000)}${"TAIL".repeat(1000)}`;
    const truncated = truncateReadMiddle(text);
    expect(truncated.length).toBeLessThanOrEqual(READ_RESULT_MAX_CHARS);
    expect(truncated.startsWith("HEAD")).toBe(true);
    expect(truncated.endsWith("TAIL")).toBe(true);
    expect(truncated).toContain("[truncated");
  });
});
