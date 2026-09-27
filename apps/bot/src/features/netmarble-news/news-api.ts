export type NewsArticle = {
  id: number;
  menuSeq: number;
  title: string;
  excerpt: string | null;
  bodyHtml: string | null;
  canonicalUrl: string;
  createdAt: string;
  isSourcePinned: boolean;
};

export type NewsListing = { articles: NewsArticle[]; failures: string[] };
export type NewsSource = {
  list(): Promise<NewsListing>;
  detail(id: number, menuSeq: number): Promise<NewsArticle>;
};

export function createNewsSource(baseUrl: string): NewsSource {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const get = async <T>(path: string, attempt = 0): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (attempt === 2) throw error;
      await wait(250 * 2 ** attempt);
      return get<T>(path, attempt + 1);
    }
    if (response.ok) return (await response.json()) as T;
    if (![429, 502, 503, 504].includes(response.status) || attempt === 2)
      throw new Error(`News API returned ${response.status} for ${path}`);
    const retryAfter = Number(response.headers.get("retry-after"));
    await wait(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 5_000)
        : 250 * 2 ** attempt,
    );
    return get<T>(path, attempt + 1);
  };
  return {
    async list() {
      const categories =
        await get<{ menuSeq: number; lastSyncedAt: string | null }[]>("v1/news/categories");
      if (categories.length !== 5 || categories.some(({ lastSyncedAt }) => !lastSyncedAt))
        throw new Error("News API has not completed its first source ingestion.");
      const results = await Promise.allSettled(
        categories.map(async ({ menuSeq }) => {
          const seenCursors = new Set<string>();
          const readPage = async (cursor?: string): Promise<NewsArticle[]> => {
            const path = `v1/news/articles?menuSeq=${menuSeq}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
            const page = await get<{ items: NewsArticle[]; nextCursor: string | null }>(path);
            if (!page.nextCursor) return page.items;
            if (seenCursors.has(page.nextCursor))
              throw new Error("News API pagination did not advance.");
            seenCursors.add(page.nextCursor);
            return [...page.items, ...(await readPage(page.nextCursor))];
          };
          return readPage();
        }),
      );
      const failures = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [`Category ${categories[index]!.menuSeq}: ${String(result.reason)}`]
          : [],
      );
      if (failures.length === categories.length)
        throw new Error(`All news categories failed: ${failures.join("; ")}`);
      const articles = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      articles.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);
      return { articles, failures };
    },
    detail(id, menuSeq) {
      return get<NewsArticle>(`v1/news/articles/${id}?menuSeq=${menuSeq}`);
    },
  };
}
