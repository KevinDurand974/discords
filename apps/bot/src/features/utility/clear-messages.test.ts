import { describe, expect, it } from "vitest";
import { MAX_CLEAR_AGE_MS, parseClearDuration } from "./clear-messages.ts";

describe("clear duration", () => {
  it.each([
    ["1m", 60_000],
    ["30m", 30 * 60_000],
    ["1h", 60 * 60_000],
    ["6h", 6 * 60 * 60_000],
    ["1d", 24 * 60 * 60_000],
    ["3d", 3 * 24 * 60 * 60_000],
    ["1w", 7 * 24 * 60 * 60_000],
    [" 2H ", 2 * 60 * 60_000],
    ["20160m", MAX_CLEAR_AGE_MS],
    ["336h", MAX_CLEAR_AGE_MS],
    ["14d", MAX_CLEAR_AGE_MS],
    ["2w", MAX_CLEAR_AGE_MS],
    ["15d", 15 * 24 * 60 * 60_000],
    ["3w", 21 * 24 * 60 * 60_000],
    ["30d", 30 * 24 * 60 * 60_000],
    ["337h", 337 * 60 * 60_000],
    ["20161m", 20161 * 60_000],
  ] as const)("parses %s as %i milliseconds", (input, expected) => {
    expect(parseClearDuration(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "0m",
    "-1h",
    "1.5d",
    "1s",
    "1",
    "1h30m",
    "1 h",
    "9007199254740991w",
    "9999999999999999999999999m",
  ])("rejects malformed, nonpositive or excessive duration %s", (input) => {
    expect(() => parseClearDuration(input)).toThrow("Duration must");
  });
});
