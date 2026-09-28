import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@discords/db";
import { newsCategories, netmarbleNewsSettings, sourceArticles } from "@discords/db/schema";
import { createNewsPublicationRepository } from "./news-publication-repository.ts";
import { createBotHealthServer } from "../../core/health.ts";
import type { NewsArticle } from "./news-api.ts";

const url = process.env.TEST_DATABASE_URL;
const database = url ? createDatabase(url) : undefined;
if (database) afterAll(() => database.pool.end());

const article: NewsArticle = {
  id: 918421,
  menuSeq: 32,
  title: "Bot restart integration notice",
  excerpt: null,
  bodyHtml: "<p>Durable article</p>",
  canonicalUrl: "https://forum.netmarble.com/slv_en/view/32/918421",
  createdAt: "2026-09-28T00:00:00.000Z",
  isSourcePinned: false,
};

describe.skipIf(!database)("PostgreSQL guild publication recovery", () => {
  it("keeps publication state and enabled guilds after repository recreation", async () => {
    await database!.db
      .insert(newsCategories)
      .values({ menuSeq: 32, name: "Notices" })
      .onConflictDoNothing();
    await database!.db
      .insert(sourceArticles)
      .values({
        ...article,
        createdAt: new Date(article.createdAt),
      })
      .onConflictDoNothing();
    await database!.db.insert(netmarbleNewsSettings).values({
      guildId: "integration-guild",
      forumChannelId: "forum-1",
      initialImportMode: "backfill",
    });
    const first = createNewsPublicationRepository();
    await first.skip("integration-guild", article);
    await first.publish("integration-guild", article, "thread-1");
    const recovered = createNewsPublicationRepository();
    expect(await recovered.enabledGuildIds()).toContain("integration-guild");
    expect(await recovered.known("integration-guild")).toContainEqual({
      id: article.id,
      state: "published",
      threadId: "thread-1",
      discordPinned: false,
    });
    await expect(recovered.publish("integration-guild", article, "thread-2")).rejects.toThrow(
      "already published",
    );
    const health = createBotHealthServer({ isReady: () => true }, url);
    await new Promise<void>((resolve) => health.listen(0, "127.0.0.1", resolve));
    try {
      const address = health.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "ok",
        publications: [{ guildId: "integration-guild", lastPublishedAt: expect.any(String) }],
      });
    } finally {
      await new Promise<void>((resolve) => health.close(() => resolve()));
    }
  });
});
