import { createDatabase } from "@discords/db";
import { and, eq, inArray, notInArray, sql } from "@discords/db/orm";
import { netmarbleArticles, netmarbleNewsSettings } from "@discords/db/schema";
import type { NewsArticle } from "./news-api.ts";

export type KnownArticle = {
  id: number;
  state: "published";
  threadId: string | null;
  discordPinned: boolean;
};
export type NewsPublicationStore = {
  enabledGuildIds(): Promise<string[]>;
  known(guildId: string): Promise<KnownArticle[]>;
  updateSourcePins(guildId: string, pinnedIds: number[]): Promise<void>;
  setDiscordPinned(guildId: string, articleId: number, pinned: boolean): Promise<void>;
  initializeCutoff(
    guildId: string,
    article: NewsArticle,
  ): Promise<{ id: number; createdAt: string }>;
  publish(guildId: string, article: NewsArticle, threadId: string): Promise<void>;
  completeInitial(guildId: string): Promise<void>;
};

export function createNewsPublicationRepository(): NewsPublicationStore {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for news publication.");
  const { db } = createDatabase(url);
  return {
    async enabledGuildIds() {
      const rows = await db
        .select({ guildId: netmarbleNewsSettings.guildId })
        .from(netmarbleNewsSettings)
        .where(eq(netmarbleNewsSettings.enabled, true));
      return rows.map(({ guildId }) => guildId);
    },
    async known(guildId) {
      const rows = await db
        .select({
          id: netmarbleArticles.sourceArticleId,
          threadId: netmarbleArticles.threadId,
          discordPinned: netmarbleArticles.isDiscordPinned,
        })
        .from(netmarbleArticles)
        .where(eq(netmarbleArticles.guildId, guildId));
      return rows.map(({ id, threadId, discordPinned }) => ({
        id,
        state: "published" as const,
        threadId,
        discordPinned,
      }));
    },
    async updateSourcePins(guildId, pinnedIds) {
      await db
        .update(netmarbleArticles)
        .set({ isSourcePinned: false })
        .where(
          and(
            eq(netmarbleArticles.guildId, guildId),
            eq(netmarbleArticles.isSourcePinned, true),
            ...(pinnedIds.length ? [notInArray(netmarbleArticles.sourceArticleId, pinnedIds)] : []),
          ),
        );
      if (pinnedIds.length)
        await db
          .update(netmarbleArticles)
          .set({ isSourcePinned: true })
          .where(
            and(
              eq(netmarbleArticles.guildId, guildId),
              eq(netmarbleArticles.isSourcePinned, false),
              inArray(netmarbleArticles.sourceArticleId, pinnedIds),
            ),
          );
    },
    async setDiscordPinned(guildId, articleId, pinned) {
      const rows = await db
        .update(netmarbleArticles)
        .set({ isDiscordPinned: pinned })
        .where(
          and(
            eq(netmarbleArticles.guildId, guildId),
            eq(netmarbleArticles.sourceArticleId, articleId),
            eq(netmarbleArticles.syncState, "published"),
          ),
        )
        .returning({ id: netmarbleArticles.sourceArticleId });
      if (rows.length !== 1)
        throw new Error(`Published article ${articleId} is missing in ${guildId}.`);
    },
    async initializeCutoff(guildId, article) {
      const [row] = await db
        .update(netmarbleNewsSettings)
        .set({
          initialSourceCreatedAt: sql`coalesce(${netmarbleNewsSettings.initialSourceCreatedAt}, ${new Date(article.createdAt)})`,
          initialSourceArticleId: sql`coalesce(${netmarbleNewsSettings.initialSourceArticleId}, ${article.id})`,
        })
        .where(eq(netmarbleNewsSettings.guildId, guildId))
        .returning({
          createdAt: netmarbleNewsSettings.initialSourceCreatedAt,
          id: netmarbleNewsSettings.initialSourceArticleId,
        });
      if (!row?.createdAt || row.id === null)
        throw new Error(`News settings are missing in ${guildId}.`);
      return { id: row.id, createdAt: row.createdAt.toISOString() };
    },
    async publish(guildId, article, threadId) {
      const rows = await db
        .insert(netmarbleArticles)
        .values({
          guildId,
          sourceArticleId: article.id,
          menuSeq: article.menuSeq,
          sourceCreatedAt: new Date(article.createdAt),
          syncState: "published",
          threadId,
          publishedAt: new Date(),
          isSourcePinned: article.isSourcePinned,
        })
        .onConflictDoNothing()
        .returning({ threadId: netmarbleArticles.threadId });
      if (rows.length !== 1)
        throw new Error(`Article ${article.id} was already published in guild ${guildId}.`);
    },
    async completeInitial(guildId) {
      await db
        .update(netmarbleNewsSettings)
        .set({ initialImportCompletedAt: new Date() })
        .where(
          and(eq(netmarbleNewsSettings.guildId, guildId), eq(netmarbleNewsSettings.enabled, true)),
        );
    },
  };
}
