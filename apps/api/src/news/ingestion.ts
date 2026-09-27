import { and, eq, inArray } from "@discords/db/orm";
import type { Database } from "@discords/db";
import { newsCategories, sourceArticleMedia, sourceArticles } from "@discords/db/schema";
import { NEWS_CATEGORIES, type MenuSeq, type SourceArticle, type SourceList, createNetmarbleClient } from "./netmarble-client.ts";

export function normalizeArticle(article: SourceArticle, pinned: boolean) {
  if (!Number.isSafeInteger(article.regDate) || !Number.isFinite(new Date(article.regDate).getTime())) {
    throw new Error(`Invalid date for Netmarble article ${article.id}`);
  }
  return {
    id: article.id,
    menuSeq: article.menuSeq,
    title: article.title,
    excerpt: article.content.slice(0, 500),
    bodyHtml: article.content,
    thumbnailUrl: article.thumbnailUrl || null,
    canonicalUrl: `https://forum.netmarble.com/slv_en/view/${article.menuSeq}/${article.id}`,
    createdAt: new Date(article.regDate),
    updatedAt: article.modDate ? new Date(article.modDate) : null,
    isSourcePinned: pinned,
  };
}

export function mergeSourceList(list: SourceList) {
  const pinnedIds = new Set(list.recommendList.map(({ id }) => id));
  const articles = new Map([...list.articleList, ...list.recommendList].map((article) => [article.id, article]));
  return { articles: [...articles.values()], pinnedIds };
}

async function fetchDetails(
  articles: SourceArticle[],
  client: ReturnType<typeof createNetmarbleClient>,
  menuSeq: MenuSeq,
): Promise<SourceArticle[]> {
  if (!articles.length) return [];
  const batch = await Promise.all(articles.slice(0, 5).map(({ id }) => client.getArticle(id, menuSeq)));
  return [...batch, ...await fetchDetails(articles.slice(5), client, menuSeq)];
}

export function createIngestion(db: Database, client = createNetmarbleClient()) {
  let running = false;

  async function ingestCategory(menuSeq: MenuSeq): Promise<number> {
    const list = await client.listArticles(menuSeq, 0, 50);
    const { articles, pinnedIds } = mergeSourceList(list);
    const existing = articles.length ? await db.select({ id: sourceArticles.id })
      .from(sourceArticles).where(inArray(sourceArticles.id, articles.map(({ id }) => id))) : [];
    const knownIds = new Set(existing.map(({ id }) => id));
    const details = await fetchDetails(articles.filter(({ id }) => !knownIds.has(id)), client, menuSeq);
    const category = NEWS_CATEGORIES.find((item) => item.menuSeq === menuSeq)!;

    await db.transaction(async (tx) => {
      await tx.insert(newsCategories).values({ menuSeq, name: category.name })
        .onConflictDoUpdate({ target: newsCategories.menuSeq, set: { name: category.name } });
      await tx.update(sourceArticles).set({ isSourcePinned: false })
        .where(and(eq(sourceArticles.menuSeq, menuSeq), eq(sourceArticles.isSourcePinned, true)));
      await Promise.all(details.map(async (article) => {
        await tx.insert(sourceArticles).values(normalizeArticle(article, pinnedIds.has(article.id)))
          .onConflictDoNothing({ target: sourceArticles.id });
        const media = (article.attachFileInfo ?? []).filter((item) => typeof item.originalUrl === "string")
          .map((item, position) => ({
            articleId: article.id, position, originalUrl: item.originalUrl,
            mediaType: item.type ?? null, filename: item.fileName ?? null,
          }));
        if (media.length) await tx.insert(sourceArticleMedia).values(media).onConflictDoNothing();
      }));
      if (pinnedIds.size) await tx.update(sourceArticles).set({ isSourcePinned: true })
        .where(and(eq(sourceArticles.menuSeq, menuSeq), inArray(sourceArticles.id, [...pinnedIds])));
      await tx.update(newsCategories).set({ lastSyncedAt: new Date() }).where(eq(newsCategories.menuSeq, menuSeq));
    });
    return details.length;
  }

  return {
    ingestCategory,
    async syncAll() {
      if (running) return { skipped: true, results: [] };
      running = true;
      try {
        const results = await Promise.all(NEWS_CATEGORIES.map(async ({ menuSeq }) => {
          try {
            return { menuSeq, imported: await ingestCategory(menuSeq) };
          } catch (error) {
            return { menuSeq, error: error instanceof Error ? error.message : String(error) };
          }
        }));
        return { skipped: false, results };
      } finally {
        running = false;
      }
    },
  };
}
