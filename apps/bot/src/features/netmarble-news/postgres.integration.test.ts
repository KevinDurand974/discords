import { afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createDatabase } from "@discords/db";
import {
  newsCategories,
  netmarbleNewsCategories,
  netmarbleNewsSettings,
  sourceArticles,
} from "@discords/db/schema";
import { eq } from "@discords/db/orm";
import { createNewsPublicationRepository } from "./news-publication-repository.ts";
import { createBotHealthServer } from "../../core/health.ts";
import { cleanNewsSetup } from "./news-setup.ts";
import { createNewsSetupRepository } from "./news-setup-repository.ts";
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
  it("migrates skipped history to one cutoff while preserving published rows", async () => {
    const connection = await database!.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(`
        CREATE TEMP TABLE netmarble_news_settings (
          guild_id text PRIMARY KEY, initial_import_completed_at timestamptz
        ) ON COMMIT DROP;
        CREATE TEMP TABLE netmarble_articles (
          guild_id text, source_article_id integer, source_created_at timestamptz,
          first_seen_at timestamptz, sync_state text, thread_id text, published_at timestamptz,
          CONSTRAINT netmarble_articles_sync_state_check CHECK (sync_state IN ('published', 'skipped')),
          CONSTRAINT netmarble_articles_publication_check CHECK (
            (sync_state = 'published' AND thread_id IS NOT NULL AND published_at IS NOT NULL)
            OR (sync_state = 'skipped' AND thread_id IS NULL AND published_at IS NULL)
          )
        ) ON COMMIT DROP;
        INSERT INTO netmarble_news_settings VALUES ('migration-guild', '2026-01-03');
        INSERT INTO netmarble_articles VALUES
          ('migration-guild', 1, '2026-01-01', '2026-01-02', 'published', 'thread-old', '2026-01-02'),
          ('migration-guild', 2, '2026-01-02', '2026-01-02', 'skipped', NULL, NULL),
          ('migration-guild', 3, '2026-01-02', '2026-01-02', 'skipped', NULL, NULL),
          ('migration-guild', 4, '2026-02-01', '2026-02-01', 'published', 'thread-new', '2026-02-01');
      `);
      const migration = await readFile(
        new URL(
          "../../../../../packages/db/drizzle/20261003181343_sloppy_bloodstorm/migration.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await connection.query(migration);
      const history = await connection.query(
        "SELECT source_article_id, thread_id FROM netmarble_articles ORDER BY source_article_id",
      );
      expect(history.rows).toEqual([
        { source_article_id: 1, thread_id: "thread-old" },
        { source_article_id: 4, thread_id: "thread-new" },
      ]);
      const baseline = await connection.query(
        "SELECT initial_source_article_id FROM netmarble_news_settings",
      );
      expect(baseline.rows).toEqual([{ initial_source_article_id: 3 }]);
      await expect(
        connection.query(`
        INSERT INTO netmarble_articles VALUES
          ('migration-guild', 5, '2026-01-01', '2026-01-02', 'skipped', NULL, NULL)
      `),
      ).rejects.toThrow(/check constraint/);
    } finally {
      await connection.query("ROLLBACK");
      connection.release();
    }
  });
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
      initialImportMode: "future_only",
      initialBackfillCount: 0,
    });
    expect(await createNewsSetupRepository().get("integration-guild")).toMatchObject({
      initialImportMode: "future_only",
      initialBackfillCount: 0,
    });
    const first = createNewsPublicationRepository();
    expect(await first.known("integration-guild")).toEqual([]);
    expect(await first.initializeCutoff("integration-guild", article)).toEqual({
      id: article.id,
      createdAt: article.createdAt,
    });
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
    await database!.db.insert(netmarbleNewsCategories).values({
      guildId: "integration-guild",
      menuSeq: 32,
      tagId: "tag-1",
      notificationRoleId: "role-1",
    });
    await database!.db.insert(netmarbleNewsSettings).values({
      guildId: "other-guild",
      forumChannelId: "other-forum",
    });
    await database!.db.insert(netmarbleNewsCategories).values({
      guildId: "other-guild",
      menuSeq: 32,
      tagId: "other-tag",
      notificationRoleId: "other-role",
    });
    await recovered.publish("other-guild", article, "other-thread");
    const setups = createNewsSetupRepository();
    expect((await setups.get("integration-guild"))?.initialSourceCutoff).toEqual({
      id: article.id,
      createdAt: article.createdAt,
    });
    expect(
      await recovered.initializeCutoff("integration-guild", {
        ...article,
        id: article.id + 1,
        createdAt: "2026-10-01T00:00:00.000Z",
      }),
    ).toEqual({ id: article.id, createdAt: article.createdAt });
    const gateway = {
      guildId: "integration-guild",
      preflight: async () => {},
      resourcesExist: async () => true,
      createRole: async () => "unused",
      deleteRole: async () => {},
      createForum: async () => ({ id: "unused", tags: [] }),
      deleteForum: async () => {},
    };
    const gate = { withGuildCleanup: async (_: string, work: () => Promise<boolean>) => work() };
    expect(await setups.publicationCount("integration-guild")).toBe(1);
    expect(await cleanNewsSetup(gateway, setups, gate, "forum-1", ["role-1"])).toBe(true);
    expect(await setups.get("integration-guild")).toBeNull();
    expect(await recovered.known("integration-guild")).toEqual([]);
    expect(await recovered.known("other-guild")).toHaveLength(1);
    expect(
      await database!.db.select().from(sourceArticles).where(eq(sourceArticles.id, article.id)),
    ).toHaveLength(1);
    await setups.save({
      guildId: "integration-guild",
      forumChannelId: "fresh-forum",
      enabled: true,
      initialImportMode: "backfill",
      initialBackfillCount: 10,
      initialImportCompleted: false,
      mappings: [{ menuSeq: 32, tagId: "fresh-tag", notificationRoleId: "fresh-role" }],
    });
    expect((await setups.get("integration-guild"))?.initialImportCompleted).toBe(false);
    expect(await setups.publicationCount("integration-guild")).toBe(0);
  });
});
