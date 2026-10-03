import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";

export const newsCategories = pgTable("news_categories", {
  menuSeq: integer("menu_seq").primaryKey(),
  name: text("name").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
}, (table) => [check("news_categories_menu_seq_check", sql`${table.menuSeq} IN (1, 13, 14, 32, 46)`) ]);

export const sourceArticles = pgTable("source_articles", {
  id: integer("id").primaryKey(),
  menuSeq: integer("menu_seq").notNull().references(() => newsCategories.menuSeq),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  bodyHtml: text("body_html"),
  thumbnailUrl: text("thumbnail_url"),
  canonicalUrl: text("canonical_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  isSourcePinned: boolean("is_source_pinned").notNull().default(false),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("source_articles_menu_date_id_idx").on(table.menuSeq, table.createdAt.desc(), table.id.desc())]);

export const sourceArticleMedia = pgTable("source_article_media", {
  articleId: integer("article_id").notNull().references(() => sourceArticles.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  originalUrl: text("original_url").notNull(),
  mediaType: text("media_type"),
  filename: text("filename"),
}, (table) => [
  primaryKey({ columns: [table.articleId, table.position] }),
  check("source_article_media_position_check", sql`${table.position} >= 0`),
]);

export const netmarbleNewsSettings = pgTable("netmarble_news_settings", {
  guildId: varchar("guild_id", { length: 20 }).primaryKey(),
  forumChannelId: varchar("forum_channel_id", { length: 20 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(30),
  initialImportMode: text("initial_import_mode").notNull().default("backfill"),
  initialBackfillCount: integer("initial_backfill_count").notNull().default(10),
  initialImportCompletedAt: timestamp("initial_import_completed_at", { withTimezone: true }),
  initialSourceCreatedAt: timestamp("initial_source_created_at", { withTimezone: true }),
  initialSourceArticleId: integer("initial_source_article_id"),
}, (table) => [
  check("netmarble_news_settings_poll_interval_check", sql`${table.pollIntervalMinutes} > 0`),
  check("netmarble_news_settings_import_mode_check", sql`${table.initialImportMode} IN ('backfill', 'future_only')`),
  check("netmarble_news_settings_backfill_count_check", sql`${table.initialBackfillCount} BETWEEN 0 AND 50`),
]);

export const netmarbleNewsCategories = pgTable("netmarble_news_categories", {
  guildId: varchar("guild_id", { length: 20 }).notNull().references(() => netmarbleNewsSettings.guildId, { onDelete: "cascade" }),
  menuSeq: integer("menu_seq").notNull().references(() => newsCategories.menuSeq),
  tagId: varchar("tag_id", { length: 20 }).notNull(),
  notificationRoleId: varchar("notification_role_id", { length: 20 }).notNull(),
}, (table) => [primaryKey({ columns: [table.guildId, table.menuSeq] })]);

export const netmarbleArticles = pgTable("netmarble_articles", {
  guildId: varchar("guild_id", { length: 20 }).notNull().references(() => netmarbleNewsSettings.guildId, { onDelete: "cascade" }),
  sourceArticleId: integer("source_article_id").notNull().references(() => sourceArticles.id),
  menuSeq: integer("menu_seq").notNull().references(() => newsCategories.menuSeq),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }).notNull(),
  syncState: text("sync_state").notNull(),
  threadId: varchar("thread_id", { length: 20 }),
  isSourcePinned: boolean("is_source_pinned").notNull().default(false),
  isDiscordPinned: boolean("is_discord_pinned").notNull().default(false),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.sourceArticleId] }),
  unique("netmarble_articles_thread_id_unique").on(table.threadId),
  check("netmarble_articles_sync_state_check", sql`${table.syncState} = 'published'`),
  check("netmarble_articles_publication_check", sql`${table.threadId} IS NOT NULL AND ${table.publishedAt} IS NOT NULL`),
]);
