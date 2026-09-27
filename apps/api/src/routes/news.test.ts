import { describe, expect, it, vi } from "vitest";
import type { NewsReader } from "../news/repository.ts";
import { createNewsApp } from "./news.ts";

const record = {
  id: 100, menuSeq: 32, title: "Notice", excerpt: "Preview", bodyHtml: "<p>Text</p>",
  thumbnailUrl: null, canonicalUrl: "https://forum.netmarble.com/slv_en/view/32/100",
  createdAt: "2026-09-21T00:00:00.000Z", updatedAt: null, isSourcePinned: false,
};

const reader: NewsReader = {
  categories: vi.fn(async () => [{ menuSeq: 32, name: "Notices", lastSyncedAt: null }]),
  articles: vi.fn(async () => ({ items: [record], nextCursor: null })),
  article: vi.fn(async (id, menuSeq) => id === 100 && menuSeq === 32 ? { ...record, media: [] } : null),
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

  it("rejects bad parameters with validation errors", async () => {
    expect((await request("/v1/news/articles?menuSeq=999")).status).toBe(400);
    expect((await request("/v1/news/articles?limit=1000")).status).toBe(422);
    expect((await request("/v1/news/articles/oops?menuSeq=32")).status).toBe(422);
    expect((await request("/v1/news/articles/100?menuSeq=1")).status).toBe(404);
    expect((await request("/v1/news/articles/100")).status).toBe(422);
    const invalidCursorApp = createNewsApp({
      ...reader,
      articles: async () => { throw new Error("Invalid cursor"); },
    });
    const invalidCursor = await invalidCursorApp.handle(new Request("http://localhost/v1/news/articles?cursor=bad"));
    expect(invalidCursor.status).toBe(400);
  });
});
