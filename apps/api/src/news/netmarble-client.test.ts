import { describe, expect, it, vi } from "vitest";
import { createNetmarbleClient } from "./netmarble-client.ts";
import { mergeSourceList, normalizeArticle } from "./ingestion.ts";

const article = { id: 100, menuSeq: 32 as const, title: "Notice", content: "<p>Content</p>", regDate: 1789953511268, recommendDate: 999 };
const pinned = { ...article, id: 101, recommendDate: 0 };

const fetcher = vi.fn<typeof fetch>(async () => Response.json({
  code: 0, articleList: [article], recommendList: [pinned], totalCount: 200,
  article,
}));

describe("Netmarble client", () => {
  it("uses rows/start and category filters for list requests", async () => {
    const result = await createNetmarbleClient(fetcher).listArticles(32, 50, 25);
    const url = fetcher.mock.lastCall?.[0] as URL;
    expect(Object.fromEntries(url.searchParams)).toEqual({
      rows: "25", start: "50", menuSeq: "32", filterLanguageCd: "en_US", sort: "NEW",
    });
    expect(result.totalCount).toBe(200);
  });

  it("requests details with the matching category", async () => {
    await createNetmarbleClient(fetcher).getArticle(100, 32);
    expect((fetcher.mock.lastCall?.[0] as URL).toString()).toContain("/article/100?menuSeq=32");
  });

  it("marks pins exclusively from recommendList, including pinned-only articles", () => {
    const merged = mergeSourceList({ articleList: [article], recommendList: [pinned], totalCount: 2 });
    expect(merged.articles.map(({ id }) => id)).toEqual([100, 101]);
    expect(merged.pinnedIds.has(100)).toBe(false);
    expect(merged.pinnedIds.has(101)).toBe(true);
    expect(normalizeArticle(article, merged.pinnedIds.has(100)).isSourcePinned).toBe(false);
    expect(normalizeArticle(pinned, merged.pinnedIds.has(101)).canonicalUrl)
      .toBe("https://forum.netmarble.com/slv_en/view/32/101");
  });

  it("rejects unsuccessful and malformed responses", async () => {
    const failed = vi.fn<typeof fetch>(async () => Response.json({ code: 1 }));
    await expect(createNetmarbleClient(failed).listArticles(32)).rejects.toThrow("unsuccessful");
  });
});
