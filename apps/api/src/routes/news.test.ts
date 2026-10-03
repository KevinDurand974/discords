import { describe, expect, it, vi } from "vitest";
import type { NewsReader } from "../news/repository.ts";
import { createNewsApp } from "./news.ts";

const record = {
  id: 100,
  menuSeq: 32,
  title: "Notice",
  excerpt: "Preview",
  bodyHtml: "<p>Text</p>",
  thumbnailUrl: null,
  canonicalUrl: "https://forum.netmarble.com/slv_en/view/32/100",
  createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: null,
  isSourcePinned: false,
};

const reader: NewsReader = {
  categories: vi.fn(async () => [{ menuSeq: 32, name: "Notices", lastSyncedAt: null }]),
  articles: vi.fn(async () => ({ items: [record], nextCursor: null })),
  article: vi.fn(async (id, menuSeq) =>
    id === 100 && menuSeq === 32 ? { ...record, media: [] } : null,
  ),
};
const app = createNewsApp(reader);
const request = (path: string) => app.handle(new Request(`http://localhost${path}`));

describe("public news routes", () => {
  it("returns public categories and paged articles without guild information", async () => {
    const categories = await request("/v1/news/categories");
    expect(categories.status).toBe(200);
    expect(await categories.json()).toEqual([{ menuSeq: 32, name: "Notices", lastSyncedAt: null }]);
    const articles = await request("/v1/news/articles?menuSeq=32&limit=5");
    expect(articles.status).toBe(200);
    expect(await articles.json()).toEqual({ items: [record], nextCursor: null });
    expect(reader.articles).toHaveBeenCalledWith(32, 5, undefined);
  });

  it("returns detail and media only for the matching category", async () => {
    const response = await request("/v1/news/articles/100?menuSeq=32");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...record, media: [] });
    expect((await request("/v1/news/articles/999?menuSeq=32")).status).toBe(404);
  });

  it("runs ingestion only through the authenticated jobs endpoint", async () => {
    const synchronize = vi.fn(async () => {});
    const jobs = createNewsApp(reader, { jobToken: "jobs-token", synchronize });
    const call = (authorization?: string) =>
      jobs.handle(
        new Request("http://localhost/internal/jobs/news-ingestion", {
          method: "POST",
          headers: authorization ? { Authorization: authorization } : {},
        }),
      );
    expect((await call()).status).toBe(401);
    expect((await call("Bearer jobs-token")).status).toBe(204);
    expect(synchronize).toHaveBeenCalledOnce();
  });

  it("reports database readiness without exposing it to the public rate limit", async () => {
    const ready = await request("/health/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      status: "ok",
      categories: [{ menuSeq: 32, lastSyncedAt: null }],
    });
    const unavailable = createNewsApp({
      ...reader,
      categories: async () => {
        throw new Error("DB down");
      },
    });
    expect((await unavailable.handle(new Request("http://localhost/health/ready"))).status).toBe(
      503,
    );
    expect((await unavailable.handle(new Request("http://localhost/health/live"))).status).toBe(
      200,
    );
  });

  it("limits public requests but reserves bot access via a shared secret", async () => {
    const internal = {
      ...reader,
      categories: vi.fn(async () => [{ menuSeq: 13, name: "Events", lastSyncedAt: null }]),
    };
    const limited = createNewsApp(reader, {
      internalReader: internal,
      internalToken: "private-test-token",
    });
    const send = (headers?: Record<string, string>) =>
      limited.handle(
        new Request("http://localhost/v1/news/categories", headers ? { headers } : {}),
      );
    const responses = await Promise.all(Array.from({ length: 121 }, () => send()));
    expect(responses.slice(0, 120).every((response) => response.status === 200)).toBe(true);
    expect(responses[120]!.status).toBe(429);
    expect(responses[120]!.headers.get("retry-after")).toBeTruthy();
    const bot = await send({ Authorization: "Bearer private-test-token" });
    expect(bot.status).toBe(200);
    expect(await bot.json()).toEqual([{ menuSeq: 13, name: "Events", lastSyncedAt: null }]);
    expect(internal.categories).toHaveBeenCalledOnce();
    expect((await send({ Authorization: "Bearer wrong" })).status).toBe(429);
  });

  it("allows only explicitly configured browser origins and preflights", async () => {
    const restricted = createNewsApp(reader, { allowedOrigins: ["https://example.com"] });
    const call = (origin: string, method = "GET") =>
      restricted.handle(
        new Request("http://localhost/v1/news/categories", { method, headers: { Origin: origin } }),
      );
    expect((await call("https://example.com")).headers.get("access-control-allow-origin")).toBe(
      "https://example.com",
    );
    expect(
      (await call("https://evil.example")).headers.get("access-control-allow-origin"),
    ).toBeNull();
    expect((await call("https://example.com", "OPTIONS")).status).toBe(204);
    expect((await call("https://evil.example", "OPTIONS")).status).toBe(403);
  });

  it("rejects bad parameters with validation errors", async () => {
    expect((await request("/v1/news/articles?menuSeq=999")).status).toBe(400);
    expect((await request("/v1/news/articles?limit=1000")).status).toBe(422);
    expect((await request("/v1/news/articles/oops?menuSeq=32")).status).toBe(422);
    expect((await request("/v1/news/articles/100?menuSeq=1")).status).toBe(404);
    expect((await request("/v1/news/articles/100")).status).toBe(422);
    const invalidCursorApp = createNewsApp({
      ...reader,
      articles: async () => {
        throw new Error("Invalid cursor");
      },
    });
    const invalidCursor = await invalidCursorApp.handle(
      new Request("http://localhost/v1/news/articles?cursor=bad"),
    );
    expect(invalidCursor.status).toBe(400);
  });
});
