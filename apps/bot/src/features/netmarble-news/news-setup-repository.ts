import { createDatabase } from "@discords/db";
import { and, eq, sql } from "@discords/db/orm";
import {
  netmarbleArticles,
  netmarbleNewsCategories,
  netmarbleNewsSettings,
} from "@discords/db/schema";
import type { NewsSetupStore } from "./news-setup.ts";

let database: ReturnType<typeof createDatabase> | undefined;

export function createNewsSetupRepository(): NewsSetupStore {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for news setup.");
  database ??= createDatabase(url);
  const { db } = database;
  return {
    async get(guildId) {
      const [settings] = await db
        .select()
        .from(netmarbleNewsSettings)
        .where(eq(netmarbleNewsSettings.guildId, guildId))
        .limit(1);
      if (!settings) return null;
      const mappings = await db
        .select()
        .from(netmarbleNewsCategories)
        .where(eq(netmarbleNewsCategories.guildId, guildId));
      return {
        guildId,
        forumChannelId: settings.forumChannelId,
        enabled: settings.enabled,
        initialImportMode:
          settings.initialImportMode === "future_only" ? "future_only" : "backfill",
        initialBackfillCount: settings.initialBackfillCount,
        initialImportCompleted: settings.initialImportCompletedAt !== null,
        mappings: mappings.map(({ menuSeq, tagId, notificationRoleId }) => ({
          menuSeq,
          tagId,
          notificationRoleId,
        })),
      };
    },
    async save(setup) {
      await db.transaction(async (tx) => {
        await tx.insert(netmarbleNewsSettings).values({
          guildId: setup.guildId,
          forumChannelId: setup.forumChannelId,
          initialImportMode: setup.initialImportMode,
          initialBackfillCount: setup.initialBackfillCount,
        });
        await tx.insert(netmarbleNewsCategories).values(
          setup.mappings.map((mapping) => ({
            guildId: setup.guildId,
            ...mapping,
          })),
        );
      });
    },
    async setEnabled(guildId, enabled) {
      const rows = await db
        .update(netmarbleNewsSettings)
        .set({ enabled })
        .where(eq(netmarbleNewsSettings.guildId, guildId))
        .returning({ guildId: netmarbleNewsSettings.guildId });
      return rows.length > 0;
    },
    async publicationCount(guildId) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(netmarbleArticles)
        .where(eq(netmarbleArticles.guildId, guildId));
      return row?.count ?? 0;
    },
    async delete(guildId, forumChannelId) {
      const rows = await db
        .delete(netmarbleNewsSettings)
        .where(
          and(
            eq(netmarbleNewsSettings.guildId, guildId),
            eq(netmarbleNewsSettings.forumChannelId, forumChannelId),
          ),
        )
        .returning({ guildId: netmarbleNewsSettings.guildId });
      return rows.length > 0;
    },
  };
}
