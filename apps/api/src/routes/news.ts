import { Elysia, t } from "elysia";
import { node } from "@elysiajs/node";
import { isMenuSeq } from "../news/netmarble-client.ts";
import type { NewsReader } from "../news/repository.ts";
import { corsHeaders, createPublicRateLimiter } from "./public-policy.ts";

const errorSchema = t.Object({ error: t.String() });
const articleSchema = t.Object({
  id: t.Number(),
  menuSeq: t.Number(),
  title: t.String(),
  excerpt: t.Nullable(t.String()),
  bodyHtml: t.Nullable(t.String()),
  thumbnailUrl: t.Nullable(t.String()),
  canonicalUrl: t.String(),
  createdAt: t.String(),
  updatedAt: t.Nullable(t.String()),
  isSourcePinned: t.Boolean(),
});

export type NewsAppOptions = {
  allowedOrigins?: string[];
  internalToken?: string | undefined;
  internalReader?: NewsReader | undefined;
  jobToken?: string | undefined;
  synchronize?: (() => Promise<void>) | undefined;
};

export function createNewsApp(reader: NewsReader, options: NewsAppOptions = {}) {
  const limit = createPublicRateLimiter();
  const authorized = (request: Request) =>
    Boolean(
      options.internalToken &&
      request.headers.get("authorization") === `Bearer ${options.internalToken}`,
    );
  const source = (request: Request) =>
    authorized(request) ? (options.internalReader ?? reader) : reader;
  const jobAuthorized = (request: Request) =>
    Boolean(
      options.jobToken && request.headers.get("authorization") === `Bearer ${options.jobToken}`,
    );
  return new Elysia({ adapter: node() })
    .onRequest(({ request, set }) => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/v1/news/")) return;
      const origin = request.headers.get("origin");
      Object.assign(set.headers, corsHeaders(origin, options.allowedOrigins ?? []));
      if (request.method === "OPTIONS") {
        if (!origin || !(options.allowedOrigins ?? []).includes(origin))
          return new Response(null, { status: 403 });
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders(origin, options.allowedOrigins ?? []),
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
          },
        });
      }
      if (!authorized(request)) {
        const retryAfter = limit("public");
        if (retryAfter)
          return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
          });
      }
    })
    .get("/health/live", () => ({ status: "ok" }))
    .post("/internal/jobs/news-ingestion", async ({ request, status }) => {
      if (!jobAuthorized(request)) return status(401, { error: "Unauthorized" });
      if (!options.synchronize) return status(503, { error: "Job handler unavailable" });
      await options.synchronize();
      return status(204);
    })
    .get("/health/ready", async ({ status }) => {
      try {
        const categories = await reader.categories();
        return {
          status: "ok",
          categories: categories.map(({ menuSeq, lastSyncedAt }) => ({ menuSeq, lastSyncedAt })),
        };
      } catch (error) {
        console.error("[Healthcheck] Database error:", error);
        return status(503, { status: "unavailable" });
      }
    })
    .get("/v1/news/categories", ({ request }) => source(request).categories(), {
      response: t.Array(
        t.Object({
          menuSeq: t.Number(),
          name: t.String(),
          lastSyncedAt: t.Nullable(t.String()),
        }),
      ),
    })
    .get(
      "/v1/news/articles",
      async ({ query, status, request }) => {
        const menuSeq = query.menuSeq;
        if (menuSeq !== undefined && !isMenuSeq(menuSeq))
          return status(400, { error: "Unsupported menuSeq" });
        try {
          return await source(request).articles(menuSeq, query.limit ?? 20, query.cursor);
        } catch (error) {
          if (error instanceof Error && error.message === "Invalid cursor")
            return status(400, { error: error.message });
          throw error;
        }
      },
      {
        query: t.Object({
          menuSeq: t.Optional(t.Numeric({ minimum: 1, integer: true })),
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, integer: true })),
          cursor: t.Optional(t.String({ minLength: 1 })),
        }),
        response: {
          200: t.Object({ items: t.Array(articleSchema), nextCursor: t.Nullable(t.String()) }),
          400: errorSchema,
        },
      },
    )
    .get(
      "/v1/news/articles/:articleId",
      async ({ params, query, status, request }) => {
        if (!isMenuSeq(query.menuSeq)) return status(400, { error: "Unsupported menuSeq" });
        const article = await source(request).article(params.articleId, query.menuSeq);
        return article ?? status(404, { error: "Article not found" });
      },
      {
        params: t.Object({ articleId: t.Numeric({ minimum: 1, integer: true }) }),
        query: t.Object({ menuSeq: t.Numeric({ minimum: 1, integer: true }) }),
        response: {
          200: t.Intersect([
            articleSchema,
            t.Object({
              media: t.Array(
                t.Object({
                  position: t.Number(),
                  originalUrl: t.String(),
                  mediaType: t.Nullable(t.String()),
                  filename: t.Nullable(t.String()),
                }),
              ),
            }),
          ]),
          400: errorSchema,
          404: errorSchema,
        },
      },
    );
}
