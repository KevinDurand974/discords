import {
  DiscordAPIError,
  RESTJSONErrorCodes,
  type NewsChannel,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import pEachSeries from "p-each-series";

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
    throw new UserFacingError(
      "Duration must be a positive whole number followed by m, h, d or w (for example, 30m or 2d).",
    );
  }
  const amount = Number(match[1]);
  const duration = amount * DURATION_UNITS[match[2] as keyof typeof DURATION_UNITS];
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(duration)) {
    throw new UserFacingError("Duration must be positive. Choose a shorter duration.");
  }
  return duration;
}

export async function clearMessages(
  channel: TextChannel | NewsChannel | ThreadChannel,
  count: number,
  userId?: string,
  maxAgeMs?: number,
): Promise<number> {
  const messages = await channel.messages.fetch({ limit: userId ? 100 : count });
  const cutoff = maxAgeMs === undefined ? -Infinity : Date.now() - maxAgeMs;
  const selected = messages
    .filter(
      (message) => (!userId || message.author.id === userId) && message.createdTimestamp > cutoff,
    )
    .first(count);
  if (selected.length === 0) return 0;
  const bulkCutoff = Date.now() - MAX_CLEAR_AGE_MS;
  const recent = selected.filter((message) => message.createdTimestamp > bulkCutoff);
  const bulkDeleted =
    recent.length === 0 ? new Map<string, unknown>() : await channel.bulkDelete(recent, true);
  let deletedCount = bulkDeleted.size;
  await pEachSeries(
    selected.filter((message) => !bulkDeleted.has(message.id)),
    async (message) => {
      try {
        await message.delete();
        deletedCount += 1;
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage)
          return;
        if (deletedCount === 0) throw error;
        throw new UserFacingError(
          `Deleted ${deletedCount} message${deletedCount === 1 ? "" : "s"}, but couldn't delete the rest. Check bot permissions, then try /clear again.`,
          { cause: error },
        );
      }
    },
  );
  return deletedCount;
}
