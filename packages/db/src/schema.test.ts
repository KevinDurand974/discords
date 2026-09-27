import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  netmarbleArticles,
  netmarbleNewsCategories,
  netmarbleNewsSettings,
  newsCategories,
  sourceArticleMedia,
  sourceArticles,
} from "./schema.ts";

const columnNames = (table: Parameters<typeof getTableColumns>[0]) =>
  Object.keys(getTableColumns(table));

describe("news database schema", () => {
  it("separates global source data from guild configuration", () => {
    expect(getTableName(newsCategories)).toBe("news_categories");
    expect(getTableName(sourceArticles)).toBe("source_articles");
    expect(getTableName(sourceArticleMedia)).toBe("source_article_media");
    expect(columnNames(sourceArticles)).not.toContain("guildId");
    expect(columnNames(netmarbleNewsSettings)).toContain("forumChannelId");
    expect(columnNames(netmarbleNewsCategories)).toEqual([
      "guildId", "menuSeq", "tagId", "notificationRoleId",
    ]);
  });

  it("tracks per-guild article publication and pin reconciliation", () => {
    expect(columnNames(netmarbleArticles)).toEqual([
      "guildId", "sourceArticleId", "menuSeq", "sourceCreatedAt", "syncState",
      "threadId", "isSourcePinned", "isDiscordPinned", "firstSeenAt", "publishedAt",
    ]);
    expect(netmarbleArticles.threadId.notNull).toBe(false);
    expect(netmarbleNewsSettings.pollIntervalMinutes.default).toBe(30);
    expect(netmarbleNewsSettings.initialBackfillCount.default).toBe(10);
    expect(netmarbleNewsSettings.initialImportCompletedAt.notNull).toBe(false);
  });
});
