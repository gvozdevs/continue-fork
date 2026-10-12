import { expect, test } from "vitest";
import {
  collapseRepeatedContent,
  collapseRepeatedParagraphs,
} from "./collapseRepeats";

test("a paragraph repeated many times is kept once", () => {
  const line = "Let me read the redis files and parser files.";
  const text = ["Let me read these.", line, line, line, line].join("\n\n");
  expect(collapseRepeatedParagraphs(text)).toBe(
    `Let me read these.\n\n${line}`,
  );
});

test("alternating repeats are each kept once, in order", () => {
  const a = "Let me update the enrichJobs function.";
  const b = "Let me make the edit to search.go.";
  const text = [a, b, a, b, a, b].join("\n\n");
  expect(collapseRepeatedParagraphs(text)).toBe(`${a}\n\n${b}`);
});

test("case and spacing differences still count as a repeat", () => {
  const text = "Let me read the file.\n\nlet me  read the file.";
  expect(collapseRepeatedParagraphs(text)).toBe("Let me read the file.");
});

test("code fences and short lines are left alone", () => {
  const text = [
    "Result:",
    "```go",
    "}",
    "",
    "}",
    "```",
    "Done.",
    "",
    "Done.",
  ].join("\n");
  expect(collapseRepeatedParagraphs(text)).toBe(text);
});

test("distinct paragraphs are unchanged", () => {
  const text = "First step here.\n\nSecond step here.\n\nThird step here.";
  expect(collapseRepeatedParagraphs(text)).toBe(text);
});

test("message parts are collapsed part by part", () => {
  const parts = collapseRepeatedContent([
    { type: "text", text: "Same sentence here.\n\nSame sentence here." },
    { type: "imageUrl", imageUrl: { url: "data:x" } },
  ]);
  expect(parts).toEqual([
    { type: "text", text: "Same sentence here." },
    { type: "imageUrl", imageUrl: { url: "data:x" } },
  ]);
});
