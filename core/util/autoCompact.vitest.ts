import { describe, expect, it } from "vitest";
import {
  AUTO_COMPACT_STALE_TOKENS,
  shouldAutoCompactContext,
  staleHistoryTokenLimit,
} from "./autoCompact";

describe("shouldAutoCompactContext", () => {
  it("compacts at 90% of the input budget", () => {
    expect(shouldAutoCompactContext({ contextPercentage: 0.9 })).toBe(true);
    expect(shouldAutoCompactContext({ contextPercentage: 0.89 })).toBe(false);
  });

  it("compacts when history was already pruned or cannot fit", () => {
    expect(
      shouldAutoCompactContext({ didPrune: true, contextPercentage: 0.1 }),
    ).toBe(true);
    expect(shouldAutoCompactContext({ notEnoughContext: true })).toBe(true);
  });

  it("does not compact a large spec that still fits in the window", () => {
    expect(
      shouldAutoCompactContext({
        contextPercentage: 0.2,
      }),
    ).toBe(false);
  });

  it("compacts once finished rounds beyond the task and recent tail reach 30k tokens", () => {
    expect(
      shouldAutoCompactContext({
        contextPercentage: 0.2,
        staleTokens: AUTO_COMPACT_STALE_TOKENS,
        compactStaleHistory: true,
      }),
    ).toBe(true);
    expect(
      shouldAutoCompactContext({
        contextPercentage: 0.2,
        staleTokens: AUTO_COMPACT_STALE_TOKENS - 1,
        compactStaleHistory: true,
      }),
    ).toBe(false);
  });

  it("leaves finished rounds in place when that setting is unset", () => {
    expect(
      shouldAutoCompactContext({
        contextPercentage: 0.2,
        staleTokens: AUTO_COMPACT_STALE_TOKENS,
      }),
    ).toBe(false);
  });

  it("skips the finished-round trigger when that setting is off", () => {
    expect(
      shouldAutoCompactContext({
        contextPercentage: 0.2,
        staleTokens: AUTO_COMPACT_STALE_TOKENS,
        compactStaleHistory: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoCompactContext({
        contextPercentage: 0.9,
        staleTokens: AUTO_COMPACT_STALE_TOKENS,
        compactStaleHistory: false,
      }),
    ).toBe(true);
  });

  it("uses a manually set finished-round limit", () => {
    expect(staleHistoryTokenLimit(undefined)).toBe(AUTO_COMPACT_STALE_TOKENS);
    expect(staleHistoryTokenLimit(0)).toBe(AUTO_COMPACT_STALE_TOKENS);
    expect(staleHistoryTokenLimit(10_000)).toBe(10_000);
    expect(
      shouldAutoCompactContext({
        contextPercentage: 0.2,
        staleTokens: 10_000,
        staleTokenLimit: 10_000,
        compactStaleHistory: true,
      }),
    ).toBe(true);
    expect(
      shouldAutoCompactContext({
        contextPercentage: 0.2,
        staleTokens: 9_999,
        staleTokenLimit: 10_000,
        compactStaleHistory: true,
      }),
    ).toBe(false);
  });
});
