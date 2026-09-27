export const NEWS_CATEGORIES = [
  { menuSeq: 32, name: "Notices" },
  { menuSeq: 13, name: "Developer Notes" },
  { menuSeq: 14, name: "Updates" },
  { menuSeq: 1, name: "Official News" },
  { menuSeq: 46, name: "Hunter: Origin" },
] as const;

export type MenuSeq = (typeof NEWS_CATEGORIES)[number]["menuSeq"];
export const isMenuSeq = (value: number): value is MenuSeq =>
  NEWS_CATEGORIES.some((category) => category.menuSeq === value);

export type SourceMedia = {
  originalUrl: string;
  type?: string;
  fileName?: string;
};

export type SourceArticle = {
  id: number;
  menuSeq: MenuSeq;
  title: string;
  content: string;
  regDate: number;
  modDate?: number;
  thumbnailUrl?: string;
  attachFileInfo?: SourceMedia[];
};

export type SourceList = {
  articleList: SourceArticle[];
  recommendList: SourceArticle[];
  totalCount: number;
};

const BASE_URL = "https://forum.netmarble.com/api/game/sololv/official/forum/slv_en/article";

function assertArticle(value: unknown): asserts value is SourceArticle {
  if (!value || typeof value !== "object") throw new Error("Invalid Netmarble article");
  const article = value as Partial<SourceArticle>;
  if (typeof article.id !== "number" || !isMenuSeq(Number(article.menuSeq)) ||
      typeof article.title !== "string" || typeof article.regDate !== "number" ||
      typeof article.content !== "string" ||
      (article.attachFileInfo !== undefined && !Array.isArray(article.attachFileInfo))) {
    throw new Error("Invalid Netmarble article fields");
  }
}

export function createNetmarbleClient(fetcher: typeof fetch = fetch) {
  async function request(url: URL): Promise<unknown> {
    const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Netmarble HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || (payload as { code?: unknown }).code !== 0) {
      throw new Error("Netmarble returned an unsuccessful response");
    }
    return payload;
  }

  return {
    async listArticles(menuSeq: MenuSeq, start = 0, rows = 15): Promise<SourceList> {
      if (!isMenuSeq(menuSeq) || !Number.isSafeInteger(start) || start < 0 ||
          !Number.isSafeInteger(rows) || rows < 1 || rows > 100) throw new Error("Invalid list parameters");
      const url = new URL(`${BASE_URL}/list`);
      url.search = new URLSearchParams({
        rows: String(rows), start: String(start), menuSeq: String(menuSeq),
        filterLanguageCd: "en_US", sort: "NEW",
      }).toString();
      const payload = await request(url) as Partial<SourceList>;
      if (!Array.isArray(payload.articleList) || !Array.isArray(payload.recommendList) ||
          typeof payload.totalCount !== "number") throw new Error("Invalid Netmarble list");
      [...payload.articleList, ...payload.recommendList].forEach(assertArticle);
      return payload as SourceList;
    },

    async getArticle(id: number, menuSeq: MenuSeq): Promise<SourceArticle> {
      if (!Number.isSafeInteger(id) || id < 1 || !isMenuSeq(menuSeq)) throw new Error("Invalid article parameters");
      const url = new URL(`${BASE_URL}/${id}`);
      url.searchParams.set("menuSeq", String(menuSeq));
      const payload = await request(url) as { article?: unknown };
      assertArticle(payload.article);
      if (payload.article.id !== id || payload.article.menuSeq !== menuSeq) {
        throw new Error("Netmarble article identity mismatch");
      }
      return payload.article;
    },
  };
}
