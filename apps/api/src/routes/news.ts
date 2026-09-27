import { Elysia, t } from "elysia";
import { node } from "@elysiajs/node";
import { isMenuSeq } from "../news/netmarble-client.ts";
import type { NewsReader } from "../news/repository.ts";

const errorSchema = t.Object({ error: t.String() });
const articleSchema = t.Object({
  id: t.Number(), menuSeq: t.Number(), title: t.String(),
  excerpt: t.Nullable(t.String()), bodyHtml: t.Nullable(t.String()),
  thumbnailUrl: t.Nullable(t.String()), canonicalUrl: t.String(),
  createdAt: t.String(), updatedAt: t.Nullable(t.String()), isSourcePinned: t.Boolean(),
});

export function createNewsApp(reader: NewsReader) {
  return new Elysia({ adapter: node() })
    .get("/v1/news/categories", () => reader.categories(), {
      response: t.Array(t.Object({
        menuSeq: t.Number(), name: t.String(), lastSyncedAt: t.Nullable(t.String()),
      })),
    })
    .get("/v1/news/articles", async ({ query, status }) => {
      const menuSeq = query.menuSeq;
      if (menuSeq !== undefined && !isMenuSeq(menuSeq)) return status(400, { error: "Unsupported menuSeq" });
      try {
        return await reader.articles(menuSeq, query.limit ?? 20, query.cursor);
      } catch (error) {
        if (error instanceof Error && error.message === "Invalid cursor") return status(400, { error: error.message });
        throw error;
      }
    }, {
      query: t.Object({
        menuSeq: t.Optional(t.Numeric({ minimum: 1, integer: true })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, integer: true })),
        cursor: t.Optional(t.String({ minLength: 1 })),
      }),
      response: {
        200: t.Object({ items: t.Array(articleSchema), nextCursor: t.Nullable(t.String()) }),
        400: errorSchema,
      },
    })
    .get("/v1/news/articles/:articleId", async ({ params, query, status }) => {
      if (!isMenuSeq(query.menuSeq)) return status(400, { error: "Unsupported menuSeq" });
      const article = await reader.article(params.articleId, query.menuSeq);
      return article ?? status(404, { error: "Article not found" });
    }, {
      params: t.Object({ articleId: t.Numeric({ minimum: 1, integer: true }) }),
      query: t.Object({ menuSeq: t.Numeric({ minimum: 1, integer: true }) }),
      response: {
        200: t.Intersect([articleSchema, t.Object({ media: t.Array(t.Object({
          position: t.Number(), originalUrl: t.String(), mediaType: t.Nullable(t.String()), filename: t.Nullable(t.String()),
        })) })]),
        400: errorSchema,
        404: errorSchema,
      },
    });
}
