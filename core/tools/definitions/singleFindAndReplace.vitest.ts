import { describe, expect, it } from "vitest";
import { executeMultiFindAndReplace } from "../../edit/searchAndReplace/performReplace";
import { ContinueErrorReason } from "../../util/errors";
import { editsFromSingleFindArgs } from "./singleFindAndReplace";

describe("editsFromSingleFindArgs", () => {
  it("keeps every replacement from one call", () => {
    expect(
      editsFromSingleFindArgs({
        replacements: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "d" },
        ],
      }),
    ).toEqual([
      { old_string: "a", new_string: "b", replace_all: false },
      { old_string: "c", new_string: "d", replace_all: false },
    ]);
  });

  it("accepts old_text and new_text as aliases", () => {
    expect(
      editsFromSingleFindArgs({
        replacements: [{ old_text: "a", new_text: "b" }],
      }),
    ).toEqual([{ old_string: "a", new_string: "b", replace_all: false }]);
  });

  it("accepts a single old_string/new_string pair", () => {
    expect(
      editsFromSingleFindArgs({
        old_string: "a",
        new_string: "b",
        replace_all: true,
      }),
    ).toEqual([{ old_string: "a", new_string: "b", replace_all: false }]);
  });

  it("applies replacements in order and does not offer replace_all", () => {
    const edits = editsFromSingleFindArgs({
      replacements: [
        { old_string: "one", new_string: "ONE" },
        { old_string: "two", new_string: "TWO" },
      ],
    });
    expect(executeMultiFindAndReplace("one two", edits, false)).toBe("ONE TWO");

    try {
      executeMultiFindAndReplace(
        "word word",
        [{ old_string: "word", new_string: "WORD", replace_all: false }],
        false,
      );
      throw new Error("expected multiple-match failure");
    } catch (error) {
      expect(error).toEqual(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceMultipleOccurrences,
        }),
      );
      expect(String(error)).not.toContain("replace_all");
    }
  });
});
