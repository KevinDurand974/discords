import { createDatabase } from "@discords/db";
import { and, eq, sql } from "@discords/db/orm";
import { netmarbleArticles, netmarbleNewsSettings } from "@discords/db/schema";
import type { NewsArticle } from "./news-api.ts";

export type KnownArticle = { id: number; state: "published" | "skipped" };
export type NewsPublicationStore = {
  enabledGuildIds(): Promise<string[]>;
  known(guildId: string): Promise<KnownArticle[]>;
  skip(guildId: string, article: NewsArticle): Promise<void>;
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
        .select({ id: netmarbleArticles.sourceArticleId, state: netmarbleArticles.syncState })
        .from(netmarbleArticles)
        .where(eq(netmarbleArticles.guildId, guildId));
      return rows.map(({ id, state }) => ({
        id,
        state: state === "published" ? "published" : "skipped",
      }));
    },
    async skip(guildId, article) {
      await db
        .insert(netmarbleArticles)
        .values({
          guildId,
          sourceArticleId: article.id,
          menuSeq: article.menuSeq,
          sourceCreatedAt: new Date(article.createdAt),
          syncState: "skipped",
          isSourcePinned: article.isSourcePinned,
        })
        .onConflictDoNothing();
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
        .onConflictDoUpdate({
          target: [netmarbleArticles.guildId, netmarbleArticles.sourceArticleId],
          set: {
            syncState: "published",
            threadId,
            publishedAt: new Date(),
            isSourcePinned: article.isSourcePinned,
          },
          setWhere: sql`${netmarbleArticles.syncState} = 'skipped'`,
        })
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
