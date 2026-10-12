import { expect, test } from "vitest";
import {
  DEFAULT_READ_FILE_MAX_TOKENS,
  readFileTokenLimit,
} from "./readFileMaxTokens";

test("a large context uses the default file-read window", () => {
  expect(readFileTokenLimit({ contextLength: 200_000 })).toBe(
    DEFAULT_READ_FILE_MAX_TOKENS,
  );
});

test("a user setting replaces the default and stays within half the context", () => {
  expect(readFileTokenLimit({ contextLength: 200_000 }, 10_000)).toBe(10_000);
  expect(readFileTokenLimit({ contextLength: 8_192 }, 25_000)).toBe(4_096);
});

test("a missing or empty setting falls back to the default", () => {
  expect(readFileTokenLimit({ contextLength: 200_000 }, 0)).toBe(
    DEFAULT_READ_FILE_MAX_TOKENS,
  );
  expect(readFileTokenLimit(null)).toBeUndefined();
});
