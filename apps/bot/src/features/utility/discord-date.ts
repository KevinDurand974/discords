import { UserFacingError } from "@/core/errors.ts";

const invalidDate = () =>
  new UserFacingError("Enter a valid date, e.g. 25/12/2026 18:30 or 2026-12-25T18:30.");
const normalizeWord = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replaceAll(/\p{M}|\./gu, "");
const months = new Map(
  ["en", "fr"].flatMap((locale) =>
    (["long", "short"] as const).flatMap((month) =>
      Array.from(
        { length: 12 },
        (_, index) =>
          [
            normalizeWord(
              Temporal.PlainDate.from({ year: 2026, month: index + 1, day: 1 }).toLocaleString(
                locale,
                { month },
              ),
            ),
            index + 1,
          ] as const,
      ),
    ),
  ),
);

function offsetZone(utc: number) {
  const minutes = Math.round(utc * 60);
  if (!Number.isFinite(utc) || utc < -12 || utc > 14 || Math.abs(utc * 60 - minutes) > 1e-9)
    throw new UserFacingError("Enter a UTC offset from -12 to +14, in whole minutes (e.g. 5.5).");
  return `${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
}

export function parseDiscordDate(value: string, utc = 0, now = Temporal.Now.instant()): number {
  const zone = offsetZone(utc);
  const input = value.trim();
  if (!input || input.length > 200) throw invalidDate();
  try {
    const relative = new Map([
      ["today", 0],
      ["aujourd'hui", 0],
      ["tomorrow", 1],
      ["demain", 1],
      ["yesterday", -1],
      ["hier", -1],
    ]);
    const yearFirst = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?=$|[T\s])/.exec(input);
    const dayFirst = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{4}))?(?=$|[T\s])/.exec(input);
    const dayNamed = /^(\d{1,2})\s+([\p{L}.]+)\s+(\d{4})(?=$|[T\s])/u.exec(input);
    const monthNamed = /^([\p{L}.]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})(?=$|[T\s])/u.exec(
      input,
    );
    const relativeMatch = /^(today|aujourd'hui|tomorrow|demain|yesterday|hier)(?=$|\s)/i.exec(
      input,
    );
    const match = yearFirst ?? dayFirst ?? dayNamed ?? monthNamed ?? relativeMatch;
    if (!match) throw invalidDate();
    const remainder = input
      .slice(match[0].length)
      .trim()
      .replace(/^(?:T|at\s+|à\s+)/i, "");
    const clock =
      /^(?:(\d{1,2})(?::|h)(\d{2})(?::(\d{2})(\.\d{1,9})?)?\s*(am|pm)?)?\s*(Z|(?:UTC|GMT)?[+-]\d{1,2}(?::?\d{2})?|UTC|GMT)?$/i.exec(
        remainder,
      );
    if (!clock) throw invalidDate();
    const [, rawHour, rawMinute, rawSecond, fraction, meridiem, explicitZone] = clock;
    let hour = Number(rawHour ?? 0);
    if (meridiem) {
      if (hour < 1 || hour > 12) throw invalidDate();
      hour = (hour % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
    }
    const time = Temporal.PlainTime.from(
      {
        hour,
        minute: Number(rawMinute ?? 0),
        second: Number(rawSecond ?? 0),
        nanosecond: Number((fraction?.slice(1) ?? "").padEnd(9, "0").slice(6)),
        microsecond: Number((fraction?.slice(1) ?? "").padEnd(9, "0").slice(3, 6)),
        millisecond: Number((fraction?.slice(1) ?? "").padEnd(9, "0").slice(0, 3)),
      },
      { overflow: "reject" },
    );
    const explicitOffset = explicitZone?.replace(/^(?:UTC|GMT)/i, "");
    const selectedZone = explicitZone
      ? !explicitOffset || /^Z$/i.test(explicitOffset)
        ? "+00:00"
        : explicitOffset.replace(
            /^([+-])(\d{1,2})(?::?(\d{2}))?$/,
            (_, sign: string, hours: string, minutes: string | undefined) =>
              `${sign}${hours.padStart(2, "0")}:${minutes ?? "00"}`,
          )
      : zone;
    const date = relativeMatch
      ? now
          .toZonedDateTimeISO(selectedZone)
          .toPlainDate()
          .add({ days: relative.get(relativeMatch[1]!.toLowerCase())! })
      : Temporal.PlainDate.from(
          {
            year: Number(
              yearFirst ? match[1] : (match[3] ?? now.toZonedDateTimeISO(selectedZone).year),
            ),
            month:
              yearFirst || dayFirst
                ? Number(match[2])
                : months.get(normalizeWord(dayNamed ? match[2]! : match[1]!))!,
            day: Number(yearFirst ? match[3] : monthNamed ? match[2] : match[1]),
          },
          { overflow: "reject" },
        );
    const instant = date.toPlainDateTime(time).toZonedDateTime(selectedZone).toInstant();
    return Math.floor(instant.epochMilliseconds / 1000);
  } catch {
    throw invalidDate();
  }
}
