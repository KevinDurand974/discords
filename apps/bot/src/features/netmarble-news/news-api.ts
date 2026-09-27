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

export type NewsSource = {
  list(): Promise<NewsArticle[]>;
  detail(id: number, menuSeq: number): Promise<NewsArticle>;
};

export function createNewsSource(baseUrl: string): NewsSource {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`News API returned ${response.status} for ${path}`);
    return (await response.json()) as T;
  };
  return {
    async list() {
      const categories =
        await get<{ menuSeq: number; lastSyncedAt: string | null }[]>("v1/news/categories");
      if (categories.length !== 5 || categories.some(({ lastSyncedAt }) => !lastSyncedAt))
        throw new Error("News API has not completed its first source ingestion.");
      const articles: NewsArticle[] = [];
      const seenCursors = new Set<string>();
      const readPage = async (cursor?: string): Promise<void> => {
        const path = `v1/news/articles?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const page = await get<{ items: NewsArticle[]; nextCursor: string | null }>(path);
        articles.push(...page.items);
        if (!page.nextCursor) return;
        if (seenCursors.has(page.nextCursor))
          throw new Error("News API pagination did not advance.");
        seenCursors.add(page.nextCursor);
        await readPage(page.nextCursor);
      };
      await readPage();
      return articles;
    },
    detail(id, menuSeq) {
      return get<NewsArticle>(`v1/news/articles/${id}?menuSeq=${menuSeq}`);
    },
  };
}
