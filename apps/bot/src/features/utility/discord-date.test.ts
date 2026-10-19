import { describe, expect, it } from "vitest";
import { parseDiscordDate } from "./discord-date.ts";

const now = Temporal.Instant.from("2026-06-15T22:00:00Z");
const iso = (value: string, utc = 0) =>
  Temporal.Instant.fromEpochMilliseconds(parseDiscordDate(value, utc, now) * 1000).toString({
    fractionalSecondDigits: 3,
  });

describe("Discord date parsing", () => {
  it.each([
    "2026-12-25T18:30:45",
    "2026-12-25 18:30:45",
    "25/12/2026 18:30:45",
    "25-12-2026 18:30:45",
    "25.12.2026 18:30:45",
    "December 25, 2026 at 18:30:45",
    "25 décembre 2026 à 18:30:45",
  ])("accepts %s", (value) => {
    expect(iso(value)).toBe("2026-12-25T18:30:45.000Z");
  });
  it("uses day/month/year for ambiguous numeric dates", () => {
    expect(iso("04/05/2026")).toBe("2026-05-04T00:00:00.000Z");
  });
  it("defaults to UTC and midnight rather than the server timezone or noon", () => {
    expect(iso(" 2026-12-25 ")).toBe("2026-12-25T00:00:00.000Z");
    expect(iso("25 décembre 2026")).toBe("2026-12-25T00:00:00.000Z");
  });
  it.each([
    [1, "2026-12-25T17:30:00.000Z"],
    [-5, "2026-12-25T23:30:00.000Z"],
    [5.5, "2026-12-25T13:00:00.000Z"],
    [5.75, "2026-12-25T12:45:00.000Z"],
    [14, "2026-12-25T04:30:00.000Z"],
    [-12, "2026-12-26T06:30:00.000Z"],
  ])("converts an input at UTC %s", (offset, expected) => {
    expect(iso("25/12/2026 18:30", offset)).toBe(expected);
  });
  it("honors a timezone included in the date instead of applying the offset twice", () => {
    expect(iso("2026-12-25T18:30:45Z", 5)).toBe("2026-12-25T18:30:45.000Z");
    expect(iso("2026-12-25T18:30:45+02:00", 5)).toBe("2026-12-25T16:30:45.000Z");
  });
  it("accepts relative dates using the supplied UTC offset's current date", () => {
    expect(iso("tomorrow")).toBe("2026-06-16T00:00:00.000Z");
    expect(iso("demain", 5)).toBe("2026-06-16T19:00:00.000Z");
  });
  it.each([
    ["25/12", "2026-12-25T00:00:00.000Z"],
    ["4/5", "2026-05-04T00:00:00.000Z"],
    ["25-12", "2026-12-25T00:00:00.000Z"],
    ["25.12 18:30", "2026-12-25T18:30:00.000Z"],
    ["25/12 6:30 PM", "2026-12-25T18:30:00.000Z"],
    ["25/12 12:00 AM", "2026-12-25T00:00:00.000Z"],
    ["01/01", "2026-01-01T00:00:00.000Z"],
  ])("uses the current year for %s without rolling past dates forward", (value, expected) => {
    expect(iso(value)).toBe(expected);
  });
  it.each([
    [1, "01/01 00:00", "2027-01-01T00:00:00+01:00"],
    [-1, "01/01 00:00", "2026-01-01T00:00:00-01:00"],
    [1, "01/01 00:00Z", "2026-01-01T00:00:00Z"],
    [-1, "01/01 00:00+02:00", "2027-01-01T00:00:00+02:00"],
  ] as const)("infers the year in the effective timezone: %s %s", (utc, value, expected) => {
    const boundary = Temporal.Instant.from("2026-12-31T23:30:00Z");
    expect(parseDiscordDate(value, utc, boundary)).toBe(
      Temporal.Instant.from(expected).epochMilliseconds / 1000,
    );
  });
  it("validates omitted-year leap days against the current year", () => {
    expect(() => parseDiscordDate("29/02", 0, now)).toThrow("valid date");
    expect(parseDiscordDate("29/02", 0, Temporal.Instant.from("2028-01-01T00:00:00Z"))).toBe(
      Temporal.Instant.from("2028-02-29T00:00:00Z").epochMilliseconds / 1000,
    );
  });
  it("accepts valid leap days", () => {
    expect(iso("29/02/2028")).toBe("2028-02-29T00:00:00.000Z");
  });
  it.each([
    "",
    " ",
    "not a date",
    "31/02/2026",
    "31/02",
    "12/25",
    "25/12/26",
    "25/12/2026/01",
    "25/12 trailing garbage",
    "29/02/2026",
    "2026-13-01",
    "2026-04-31",
    "25/12/2026 25:00",
    "2026-12-25T18:61",
    "2026-12-25T18:30:61",
    "2026-12-25 trailing garbage",
    "from December 25 to December 26, 2026",
    "a".repeat(201),
  ])("rejects invalid, partial or ranged input %s", (value) => {
    expect(() => parseDiscordDate(value, 0, now)).toThrow("valid date");
  });
  it.each([-13, 15, NaN, Infinity, 0.001])("rejects invalid UTC offset %s", (offset) => {
    expect(() => parseDiscordDate("2026-12-25", offset, now)).toThrow("UTC offset");
  });
});
