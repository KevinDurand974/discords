import { and, desc, eq, lt, or } from "@discords/db/orm";
import type { Database } from "@discords/db";
import { newsCategories, sourceArticleMedia, sourceArticles } from "@discords/db/schema";
import type { MenuSeq } from "./netmarble-client.ts";

export type ArticleView = {
  id: number;
  menuSeq: number;
  title: string;
  excerpt: string | null;
  bodyHtml: string | null;
  thumbnailUrl: string | null;
  canonicalUrl: string;
  createdAt: string;
  updatedAt: string | null;
  isSourcePinned: boolean;
};

export type NewsReader = {
  categories(): Promise<{ menuSeq: number; name: string; lastSyncedAt: string | null }[]>;
  articles(menuSeq: MenuSeq | undefined, limit: number, cursor?: string): Promise<{ items: ArticleView[]; nextCursor: string | null }>;
  article(id: number, menuSeq: MenuSeq): Promise<(ArticleView & { media: { position: number; originalUrl: string; mediaType: string | null; filename: string | null }[] }) | null>;
};

const encodeCursor = (createdAt: Date, id: number, menuSeq?: MenuSeq) =>
  Buffer.from(JSON.stringify({ at: createdAt.toISOString(), id, menuSeq })).toString("base64url");

function decodeCursor(cursor: string, menuSeq?: MenuSeq): { at: Date; id: number } {
  try {
    const data: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!data || typeof data !== "object") throw new Error();
    const { at, id, menuSeq: scope } = data as Record<string, unknown>;
    const date = new Date(at as string);
    if (typeof at !== "string" || !Number.isFinite(date.getTime()) ||
        typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || scope !== menuSeq) throw new Error();
    return { at: date, id };
  } catch {
    throw new Error("Invalid cursor");
  }
}

function toView(article: typeof sourceArticles.$inferSelect): ArticleView {
  return {
    id: article.id, menuSeq: article.menuSeq, title: article.title,
    excerpt: article.excerpt, bodyHtml: article.bodyHtml,
    thumbnailUrl: article.thumbnailUrl, canonicalUrl: article.canonicalUrl,
    createdAt: article.createdAt.toISOString(), updatedAt: article.updatedAt?.toISOString() ?? null,
    isSourcePinned: article.isSourcePinned,
  };
}

export function createNewsReader(db: Database): NewsReader {
  return {
    async categories() {
      const rows = await db.select().from(newsCategories);
      return rows.map((row) => ({ ...row, lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null }));
    },
    async articles(menuSeq, limit, cursor) {
      const after = cursor ? decodeCursor(cursor, menuSeq) : undefined;
      const filters = [
        menuSeq === undefined ? undefined : eq(sourceArticles.menuSeq, menuSeq),
        after ? or(lt(sourceArticles.createdAt, after.at),
          and(eq(sourceArticles.createdAt, after.at), lt(sourceArticles.id, after.id))) : undefined,
      ].filter((filter) => filter !== undefined);
      const rows = await db.select().from(sourceArticles)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(sourceArticles.createdAt), desc(sourceArticles.id)).limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toView),
        nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id, menuSeq) : null,
      };
    },
    async article(id, menuSeq) {
      const [article] = await db.select().from(sourceArticles)
        .where(and(eq(sourceArticles.id, id), eq(sourceArticles.menuSeq, menuSeq))).limit(1);
      if (!article) return null;
      const media = await db.select({
        position: sourceArticleMedia.position, originalUrl: sourceArticleMedia.originalUrl,
        mediaType: sourceArticleMedia.mediaType, filename: sourceArticleMedia.filename,
      }).from(sourceArticleMedia).where(eq(sourceArticleMedia.articleId, id))
        .orderBy(sourceArticleMedia.position);
      return { ...toView(article), media };
    },
  };
}
