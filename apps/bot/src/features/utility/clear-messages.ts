import type { NewsChannel, TextChannel, ThreadChannel } from "discord.js";

export const MAX_CLEAR_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const DURATION_UNITS = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
} as const;

export function parseClearDuration(value: string): number {
  const match = /^(\d+)([mhdw])$/.exec(value.trim().toLowerCase());
  if (!match) {
    throw new Error(
      "Duration must be a positive whole number followed by m, h, d or w (for example, 30m or 2d).",
    );
  }
  const amount = Number(match[1]);
  const duration = amount * DURATION_UNITS[match[2] as keyof typeof DURATION_UNITS];
  if (!Number.isSafeInteger(amount) || amount < 1 || duration > MAX_CLEAR_AGE_MS) {
    throw new Error(
      "Duration must be positive and cannot exceed 14 days (20160m, 336h, 14d or 2w).",
    );
  }
  return duration;
}

export async function clearMessages(
  channel: TextChannel | NewsChannel | ThreadChannel,
  count: number,
  userId?: string,
  maxAgeMs = MAX_CLEAR_AGE_MS,
): Promise<number> {
  const messages = await channel.messages.fetch({ limit: userId ? 100 : count });
  const cutoff = Date.now() - Math.min(maxAgeMs, MAX_CLEAR_AGE_MS);
  const selected = messages
    .filter(
      (message) => (!userId || message.author.id === userId) && message.createdTimestamp > cutoff,
    )
    .first(count);
  if (selected.length === 0) return 0;
  const deleted = await channel.bulkDelete(selected, true);
  return deleted.size;
}
