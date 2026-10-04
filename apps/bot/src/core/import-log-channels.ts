import { commandLogSettings } from "@discords/db/schema";
import type { createDatabase } from "@discords/db";

export async function importLogChannels(
  database: ReturnType<typeof createDatabase>,
  data: unknown,
) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Log channel settings must be an object mapping guild IDs to channel IDs.");
  }
  const rows = Object.entries(data).map(([guildId, channelId]) => {
    if (
      !/^\d{1,20}$/.test(guildId) ||
      typeof channelId !== "string" ||
      !/^\d{1,20}$/.test(channelId)
    ) {
      throw new Error(`Invalid log channel settings for guild ${guildId}.`);
    }
    return { guildId, channelId };
  });
  if (rows.length === 0) return 0;
  const inserted = await database.db
    .insert(commandLogSettings)
    .values(rows)
    .onConflictDoNothing({ target: commandLogSettings.guildId })
    .returning({ guildId: commandLogSettings.guildId });
  return inserted.length;
}
