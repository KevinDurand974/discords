import { UserFacingError } from "@/core/errors.ts";
import { parseDiscordDate } from "@/features/utility/discord-date.ts";

export const CLAIM_BUTTON_PREFIX = "sla:claim:";
export const CLAIM_MODAL_PREFIX = "sla:claim-modal:";
export type CouponAvailability = { startsAt?: number | undefined; endsAt?: number | undefined };

export function formatCouponDate(timestamp: number) {
  return Temporal.Instant.fromEpochMilliseconds(timestamp * 1000)
    .toZonedDateTimeISO("UTC")
    .toPlainDateTime()
    .toString({ smallestUnit: "second" })
    .replace("T", " ");
}

export function parseCouponAvailability(starts: string, ends: string): CouponAvailability {
  const parse = (value: string, field: "Available from" | "Available until") => {
    const input = value.trim();
    if (!input) return undefined;
    if (
      /(?:Z|UTC|GMT)(?:[+-]\d{1,2}(?::?\d{2})?)?$/i.test(input) ||
      /(?:\d[:h]\d{2}.*|\s)[+-]\d{1,2}(?::?\d{2})?$/i.test(input)
    )
      throw new UserFacingError(`**${field}:** enter a date in UTC+0 without a timezone suffix.`);
    try {
      return parseDiscordDate(input, 0);
    } catch (error) {
      if (!(error instanceof UserFacingError)) throw error;
      throw new UserFacingError(
        `**${field}:** invalid date. Use dd/MM/YYYY or YYYY/MM/dd, optionally followed by HH:mm (UTC+0). Leave empty for no limit.`,
      );
    }
  };
  const availability = {
    startsAt: parse(starts, "Available from"),
    endsAt: parse(ends, "Available until"),
  };
  if (
    availability.startsAt !== undefined &&
    availability.endsAt !== undefined &&
    availability.startsAt >= availability.endsAt
  )
    throw new UserFacingError("**Available until** must be after **Available from**.");
  return availability;
}

export function claimCustomId(code: string, availability: CouponAvailability = {}, modal = false) {
  const { startsAt, endsAt } = availability;
  const suffix =
    startsAt === undefined && endsAt === undefined
      ? ""
      : `?${startsAt?.toString(36) ?? ""}.${endsAt?.toString(36) ?? ""}`;
  const encoded = encodeURIComponent(code) + suffix;
  if (`${CLAIM_MODAL_PREFIX}${encoded}`.length > 100)
    throw new UserFacingError("Coupon code is too long for these dates. Enter a shorter code.");
  return `${modal ? CLAIM_MODAL_PREFIX : CLAIM_BUTTON_PREFIX}${encoded}`;
}

export function parseClaimCustomId(customId: string, prefix: string) {
  if (!customId.startsWith(prefix)) return null;
  try {
    const parts = customId.slice(prefix.length).split("?");
    if (parts.length > 2) return null;
    const code = decodeURIComponent(parts[0]!);
    if (!code) return null;
    const availability: CouponAvailability = {};
    if (parts[1] !== undefined) {
      const match = /^(-?[0-9a-z]+)?\.(-?[0-9a-z]+)?$/.exec(parts[1]);
      if (!match || (!match[1] && !match[2])) return null;
      const parse = (value: string | undefined) =>
        value === undefined ? undefined : Number.parseInt(value, 36);
      availability.startsAt = parse(match[1]);
      availability.endsAt = parse(match[2]);
      if (
        Object.values(availability).some(
          (value) =>
            value !== undefined &&
            (!Number.isSafeInteger(value) || Math.abs(value) > 8_640_000_000_000),
        )
      )
        return null;
      if (
        availability.startsAt !== undefined &&
        availability.endsAt !== undefined &&
        availability.startsAt >= availability.endsAt
      )
        return null;
    }
    return { code, availability };
  } catch {
    return null;
  }
}

export function assertCouponAvailable(
  { startsAt, endsAt }: CouponAvailability,
  now = Date.now() / 1000,
) {
  if (startsAt !== undefined && now < startsAt)
    throw new UserFacingError("This coupon is not available yet.");
  if (endsAt !== undefined && now >= endsAt) throw new UserFacingError("This coupon has expired.");
}
