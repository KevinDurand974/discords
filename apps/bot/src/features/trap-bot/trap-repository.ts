import { createDatabase } from "@discords/db";
import { and, eq } from "@discords/db/orm";
import { botTrapSettings } from "@discords/db/schema";

export type TrapStore = {
  getChannel(guildId: string): Promise<string | null>;
  activate(guildId: string, channelId: string): Promise<boolean>;
  clearChannel(guildId: string, channelId: string): Promise<void>;
  list(): Promise<{ guildId: string; channelId: string }[]>;
};

export function createTrapRepository(database: ReturnType<typeof createDatabase>): TrapStore {
  const { db } = database;
  return {
    async getChannel(guildId) {
      const [record] = await db
        .select()
        .from(botTrapSettings)
        .where(eq(botTrapSettings.guildId, guildId))
        .limit(1);
      return record?.channelId ?? null;
    },
    async activate(guildId, channelId) {
      const inserted = await db
        .insert(botTrapSettings)
        .values({ guildId, channelId })
        .onConflictDoNothing()
        .returning();
      return inserted.length === 1;
    },
    async clearChannel(guildId, channelId) {
      await db
        .delete(botTrapSettings)
        .where(and(eq(botTrapSettings.guildId, guildId), eq(botTrapSettings.channelId, channelId)));
    },
    async list() {
      return db.select().from(botTrapSettings);
    },
  };
}

let repository: TrapStore | undefined;
export function getTrapStore(): TrapStore {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for bot traps.");
  return (repository ??= createTrapRepository(createDatabase(process.env.DATABASE_URL)));
}
