import { createDatabase } from "@discords/db";
import { eq } from "@discords/db/orm";
import { welcomeSettings } from "@discords/db/schema";

export type WelcomeSettings = typeof welcomeSettings.$inferSelect;
export type WelcomeStore = {
  get(guildId: string): Promise<WelcomeSettings | null>;
  save(settings: WelcomeSettings): Promise<void>;
  reset(guildId: string): Promise<void>;
};

export function createWelcomeRepository(database: ReturnType<typeof createDatabase>): WelcomeStore {
  const { db } = database;
  return {
    async get(guildId) {
      const [settings] = await db
        .select()
        .from(welcomeSettings)
        .where(eq(welcomeSettings.guildId, guildId))
        .limit(1);
      return settings ?? null;
    },
    async reset(guildId) {
      await db.delete(welcomeSettings).where(eq(welcomeSettings.guildId, guildId));
    },
    async save(settings) {
      await db
        .insert(welcomeSettings)
        .values(settings)
        .onConflictDoUpdate({
          target: welcomeSettings.guildId,
          set: {
            channelId: settings.channelId,
            arrivalMessage: settings.arrivalMessage,
            departureMessage: settings.departureMessage,
          },
        });
    },
  };
}

let repository: WelcomeStore | undefined;
export function getWelcomeStore(): WelcomeStore {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for welcome messages.");
  return (repository ??= createWelcomeRepository(createDatabase(process.env.DATABASE_URL)));
}
