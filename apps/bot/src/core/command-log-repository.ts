import { createDatabase } from "@discords/db";
import { and, eq } from "@discords/db/orm";
import { commandLogSettings } from "@discords/db/schema";

export type CommandLogStore = {
  getChannel(guildId: string): Promise<string | null>;
  setChannel(guildId: string, channelId: string): Promise<void>;
  clearChannel(guildId: string, channelId: string): Promise<void>;
};

export function createCommandLogRepository(
  database: ReturnType<typeof createDatabase>,
): CommandLogStore {
  const { db } = database;
  return {
    async getChannel(guildId) {
      const [settings] = await db
        .select()
        .from(commandLogSettings)
        .where(eq(commandLogSettings.guildId, guildId))
        .limit(1);
      return settings?.channelId ?? null;
    },
    async setChannel(guildId, channelId) {
      await db
        .insert(commandLogSettings)
        .values({ guildId, channelId })
        .onConflictDoUpdate({ target: commandLogSettings.guildId, set: { channelId } });
    },
    async clearChannel(guildId, channelId) {
      await db
        .delete(commandLogSettings)
        .where(
          and(eq(commandLogSettings.guildId, guildId), eq(commandLogSettings.channelId, channelId)),
        );
    },
  };
}
