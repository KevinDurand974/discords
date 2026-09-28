import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@discords/db";
import { createIngestion } from "./ingestion.ts";
import type { createNetmarbleClient, MenuSeq } from "./netmarble-client.ts";
import { createNewsReader } from "./repository.ts";

const url = process.env.TEST_DATABASE_URL;
const database = url ? createDatabase(url) : undefined;
if (database) afterAll(() => database.pool.end());

const article = {
  id: 918420,
  menuSeq: 32 as const,
  title: "PostgreSQL integration notice",
  content: "<p>Durable article</p>",
  regDate: 1_789_920_000_000,
  attachFileInfo: [
    { originalUrl: "https://example.com/media.png", type: "image/png", fileName: "media.png" },
  ],
};
const client = {
  listArticles: async (menuSeq: MenuSeq) => ({
    articleList: menuSeq === 32 ? [article] : [],
    recommendList: menuSeq === 32 ? [article] : [],
    totalCount: menuSeq === 32 ? 1 : 0,
  }),
  getArticle: async (id: number, menuSeq: MenuSeq) => ({ ...article, id, menuSeq }),
} satisfies ReturnType<typeof createNetmarbleClient>;

describe.skipIf(!database)("PostgreSQL ingestion and recovery", () => {
  it("persists all category checkpoints, a pinned article and its media across connections", async () => {
    const ingestion = createIngestion(database!.db, client);
    const first = await ingestion.syncAll();
    expect(first.results).toContainEqual({ menuSeq: 32, imported: 1 });
    const reader = createNewsReader(database!.db);
    expect((await reader.categories()).every((category) => category.lastSyncedAt !== null)).toBe(
      true,
    );
    expect((await reader.article(article.id, 32))?.media).toEqual([
      {
        position: 0,
        originalUrl: "https://example.com/media.png",
        mediaType: "image/png",
        filename: "media.png",
      },
    ]);
    expect((await reader.article(article.id, 32))?.isSourcePinned).toBe(true);
    await ingestion.syncAll();
    const recovered = createDatabase(url!);
    try {
      expect(
        (await createNewsReader(recovered.db).articles(32, 10)).items.map(({ id }) => id),
      ).toEqual([article.id]);
    } finally {
      await recovered.pool.end();
    }
  });
});
