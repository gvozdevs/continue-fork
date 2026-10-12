import { describe, expect, it } from "vitest";
import { filePathsFromArg, readTargetsFromArgs } from "./readFile";
import {
  limitLines,
  optionalLine,
  readWindowNotice,
  sliceFileLines,
} from "../implementations/readFileWindow";

describe("filePathsFromArg", () => {
  it("keeps a single path", () => {
    expect(filePathsFromArg("a.go")).toEqual(["a.go"]);
  });

  it("keeps every path from one call", () => {
    expect(filePathsFromArg(["a.go", "b.go"])).toEqual(["a.go", "b.go"]);
  });

  it("drops empty entries", () => {
    expect(filePathsFromArg(["a.go", "  ", 1])).toEqual(["a.go"]);
  });
});

describe("readTargetsFromArgs", () => {
  it("keeps a per-file range on files[]", () => {
    expect(
      readTargetsFromArgs({
        files: [
          { path: "docs/req.md", start_line: 1, end_line: 80 },
          { path: "types.go" },
        ],
      }),
    ).toEqual([
      { path: "docs/req.md", start_line: 1, end_line: 80 },
      { path: "types.go" },
    ]);
  });

  it("applies a shared range to filepath", () => {
    expect(
      readTargetsFromArgs({
        filepath: ["a.go", "b.go"],
        start_line: 10,
        end_line: "20",
      }),
    ).toEqual([
      { path: "a.go", start_line: 10, end_line: 20 },
      { path: "b.go", start_line: 10, end_line: 20 },
    ]);
  });
});

describe("read file line window", () => {
  const doc = ["альфа", "Раздел FR3", "бета", "гамма"].join("\n");

  it("reads an inclusive 1-based range and accepts string line numbers", () => {
    const start = optionalLine({ start_line: "2" }, "start_line", "startLine");
    const end = optionalLine({ endLine: 3 }, "start_line", "end_line", "endLine");
    const sliced = sliceFileLines(doc, start, end);
    expect(sliced.lines).toEqual(["Раздел FR3", "бета"]);
    expect(sliced.startLine).toBe(2);
    expect(sliced.endLine).toBe(3);
    expect(sliced.totalLines).toBe(4);
    expect(sliced.entireFile).toBe(false);
  });

  it("keeps the whole file when no range is given", () => {
    const sliced = sliceFileLines(doc);
    expect(sliced.entireFile).toBe(true);
    expect(sliced.lines).toHaveLength(4);
  });

  it("reports a start line past the end", () => {
    const sliced = sliceFileLines(doc, 9);
    expect(sliced.pastEnd).toBe(true);
    expect(sliced.totalLines).toBe(4);
  });

  it("returns a prefix when the file is over the token limit", async () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line-${index}`);
    const fitted = await limitLines(lines, 30, async (text) => text.length);
    expect(fitted.truncated).toBe(true);
    expect(fitted.lines.length).toBeGreaterThan(0);
    expect(fitted.lines.length).toBeLessThan(lines.length);
    expect(fitted.lines.join("\n").length).toBeLessThanOrEqual(30);
  });

  it("names the next read_file call with exact line numbers", () => {
    const notice = readWindowNotice("api/swagger.yaml", 1, 400, 1000, true);
    expect(notice).toContain("600 more lines follow");
    expect(notice).toContain("Prefer grep_search");
    expect(notice).toContain('"start_line": 401');
    expect(notice).toContain('"end_line": 800');
  });

  it("clips the next window at the end of the file", () => {
    const notice = readWindowNotice("api/swagger.yaml", 401, 800, 1000, true);
    expect(notice).toContain("start_line\": 801");
  });

  it("does not offer a next window when the range is complete", () => {
    expect(readWindowNotice("a.yaml", 1, 40, 40, false)).toBe(
      "[read_file] a.yaml: lines 1-40 of 40.",
    );
  });
});
