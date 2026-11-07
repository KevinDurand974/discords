import { describe, expect, it } from "vitest";
import {
  contentChoices,
  contentLabel,
  matchesContent,
  parseContentMode,
} from "./content-filter.ts";

describe("per-creator content preferences", () => {
  it.each([
    ["all", true, true],
    ["all", false, true],
    ["all", null, true],
    ["videos", true, false],
    ["videos", false, true],
    ["videos", null, false],
    ["shorts", true, true],
    ["shorts", false, false],
    ["shorts", null, false],
  ] as const)("matches mode=%s isShort=%s: %s", (mode, isShort, expected) => {
    expect(matchesContent(mode, isShort)).toBe(expected);
  });
  it("offers and labels exactly three modes, with both content types first", () => {
    expect(contentChoices.map(({ value }) => value)).toEqual(["all", "videos", "shorts"]);
    contentChoices.forEach(({ name, value }) => {
      expect(parseContentMode(value)).toBe(value);
      expect(contentLabel(value)).toBe(name);
    });
    expect(() => parseContentMode("anything")).toThrow("Invalid YouTube content mode");
  });
});
