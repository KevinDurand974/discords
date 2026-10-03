import { Elysia, t } from "elysia";
import { node } from "@elysiajs/node";
import type { YoutubeIngestion } from "../youtube/ingestion.ts";
import { YoutubeError, type YoutubeReader } from "../youtube/types.ts";
import { corsHeaders, createPublicRateLimiter } from "./public-policy.ts";

const channelParams = t.Object({ channelId: t.String({ pattern: "^UC[A-Za-z0-9_-]{22}$" }) });
const errorSchema = t.Object({ error: t.String(), code: t.Optional(t.String()) });
const channelSchema = t.Object({
  channelId: t.String(), canonicalUrl: t.String(), handle: t.Nullable(t.String()),
  displayName: t.String(), lastSyncedAt: t.Nullable(t.String()),
});
const videoSchema = t.Object({
  videoId: t.String(), channelId: t.String(), sourceEntryId: t.String(),
  url: t.String(), title: t.String(), description: t.String(),
  publishedAt: t.String(), sourceUpdatedAt: t.Nullable(t.String()),
});

export type YoutubeAppOptions = {
  allowedOrigins?: string[];
  internalToken?: string | undefined;
  internalReader?: YoutubeReader | undefined;
  jobToken?: string | undefined;
};

export function createYoutubeApp(reader: YoutubeReader, ingestion: YoutubeIngestion, options: YoutubeAppOptions = {}) {
  const limit = createPublicRateLimiter();
  const authorized = (request: Request, token: string | undefined) =>
    Boolean(token && request.headers.get("authorization") === `Bearer ${token}`);
  const source = (request: Request) => authorized(request, options.internalToken)
    ? options.internalReader ?? reader : reader;
  return new Elysia({ adapter: node() })
    .onRequest(({ request, set }) => {
      if (!new URL(request.url).pathname.startsWith("/v1/youtube/")) return;
      const origin = request.headers.get("origin");
      Object.assign(set.headers, corsHeaders(origin, options.allowedOrigins ?? []));
      if (request.method === "OPTIONS") {
        if (!origin || !(options.allowedOrigins ?? []).includes(origin))
          return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: {
          ...corsHeaders(origin, options.allowedOrigins ?? []),
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "600",
        } });
      }
      if (!authorized(request, options.internalToken)) {
        const retryAfter = limit("public");
        if (retryAfter) return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
        });
      }
    })
    .onError(({ error, code }) => {
      if (error instanceof YoutubeError)
        return new Response(JSON.stringify({ error: error.message, code: error.code }), {
          status: error.status, headers: { "Content-Type": "application/json" },
        });
      if (code === "VALIDATION" || code === "NOT_FOUND" || code === "PARSE") return;
      return new Response(JSON.stringify({ error: "YouTube service unavailable" }), {
        status: 503, headers: { "Content-Type": "application/json" },
      });
    })
    .post("/internal/youtube/channels/resolve", ({ request, body, status }) => {
      if (!authorized(request, options.internalToken)) return status(401, { error: "Unauthorized" });
      return ingestion.resolve(body.channelUrl);
    }, {
      body: t.Object({ channelUrl: t.String({ minLength: 1, maxLength: 2048 }) }),
      response: {
        200: t.Object({ channel: channelSchema, videos: t.Array(videoSchema) }),
        401: errorSchema,
      },
    })
    .post("/internal/jobs/youtube-ingestion", async ({ request, status }) => {
      if (!authorized(request, options.jobToken)) return status(401, { error: "Unauthorized" });
      const result = await ingestion.syncAll();
      return result.complete ? result : status(503, result);
    })
    .get("/v1/youtube/channels/:channelId", async ({ request, params, status }) =>
      await source(request).channel(params.channelId) ?? status(404, { error: "Channel not found" }), {
      params: channelParams,
      response: { 200: channelSchema, 404: errorSchema },
    })
    .get("/v1/youtube/channels/:channelId/videos", async ({ request, params, query }) =>
      source(request).videos(params.channelId, query.limit ?? 10, query.cursor), {
      params: channelParams,
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, integer: true })),
        cursor: t.Optional(t.String({ minLength: 1, maxLength: 1024 })),
      }),
      response: { 200: t.Object({ items: t.Array(videoSchema), nextCursor: t.Nullable(t.String()) }) },
    });
}
