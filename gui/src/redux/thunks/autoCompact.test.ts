import { AUTO_COMPACT_STALE_TOKENS } from "core/util/autoCompact";
import {
  compactionIndex,
  KEEP_RECENT_TOKENS,
  staleHistoryTokens,
} from "./autoCompact";

function item(role: string, content = "x", toolArguments?: string) {
  return {
    message: {
      role,
      content,
      ...(toolArguments
        ? {
            toolCalls: [
              {
                function: {
                  name: "single_find_and_replace",
                  arguments: toolArguments,
                },
              },
            ],
          }
        : {}),
    },
    contextItems: [],
  } as any;
}

describe("compactionIndex", () => {
  it("leaves a short transcript, including the task spec, uncompressed", () => {
    const history = [
      item("user", "task"),
      item("assistant", "did the previous step"),
      item("user", "Continue the work and answer in the user's language."),
      item("assistant", ""),
    ];

    expect(compactionIndex(history)).toBe(-1);
  });

  it("folds older rounds once the recent tail reaches 20k tokens", () => {
    const recent = "x".repeat(KEEP_RECENT_TOKENS * 4);
    const history = [
      item("user", "spec"),
      item("assistant", "old step"),
      item("tool", "old result"),
      item("assistant", recent),
      item("tool", "recent result"),
      item("assistant", ""),
    ];

    expect(compactionIndex(history)).toBe(2);
  });

  it("does not mark the only user message", () => {
    const history = [item("user", "task"), item("assistant", "")];

    expect(compactionIndex(history)).toBe(-1);
  });

  it("ignores the task spec and counts old edit arguments as stale", () => {
    const recent = "x".repeat(KEEP_RECENT_TOKENS * 4);
    const oldEdit = "y".repeat(AUTO_COMPACT_STALE_TOKENS * 4);
    const history = [
      item("user", "s".repeat(400_000)),
      item("assistant", "created the file", oldEdit),
      item("tool", "wrote job_details.go"),
      item("assistant", recent),
      item("assistant", ""),
    ];

    expect(staleHistoryTokens(history)).toBeGreaterThanOrEqual(
      AUTO_COMPACT_STALE_TOKENS,
    );
    expect(compactionIndex(history)).toBe(2);
  });

  it("does not treat a short finished round as stale enough to summarize", () => {
    const recent = "x".repeat(KEEP_RECENT_TOKENS * 4);
    const history = [
      item("user", "s".repeat(400_000)),
      item("assistant", "created the file", "y".repeat(10_000)),
      item("assistant", recent),
      item("assistant", ""),
    ];

    expect(staleHistoryTokens(history)).toBeGreaterThan(0);
    expect(staleHistoryTokens(history)).toBeLessThan(AUTO_COMPACT_STALE_TOKENS);
  });
});
