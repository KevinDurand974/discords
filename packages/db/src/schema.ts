import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";

export const commandLogSettings = pgTable("command_log_settings", {
  guildId: varchar("guild_id", { length: 20 }).primaryKey(),
  channelId: varchar("channel_id", { length: 20 }).notNull(),
});

// Global YouTube history is independent of Discord guild subscriptions.
export const youtubeChannels = pgTable("youtube_channels", {
  channelId: varchar("channel_id", { length: 24 }).primaryKey(),
  canonicalUrl: text("canonical_url").notNull(),
  handle: text("handle"),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
}, (table) => [check("youtube_channels_id_check", sql`${table.channelId} ~ '^UC[A-Za-z0-9_-]{22}$'`)]);

export const youtubeVideos = pgTable("youtube_videos", {
  videoId: varchar("video_id", { length: 11 }).primaryKey(),
  channelId: varchar("channel_id", { length: 24 }).notNull().references(() => youtubeChannels.channelId),
  sourceEntryId: text("source_entry_id").notNull().unique(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("youtube_videos_id_check", sql`${table.videoId} ~ '^[A-Za-z0-9_-]{11}$'`),
  unique("youtube_videos_channel_video_unique").on(table.channelId, table.videoId),
  index("youtube_videos_channel_date_id_idx").on(table.channelId, table.publishedAt.desc(), table.videoId.desc()),
]);

export const youtubeForumSettings = pgTable("youtube_forum_settings", {
  guildId: varchar("guild_id", { length: 20 }).primaryKey(),
  forumChannelId: varchar("forum_channel_id", { length: 20 }),
  forumGeneration: integer("forum_generation").notNull().default(1),
  lifecycle: text("lifecycle").notNull().default("disabled"),
  ownsForum: boolean("owns_forum").notNull().default(true),
  lastPublishedAt: timestamp("last_published_at", { withTimezone: true }),
}, (table) => [
  check("youtube_forum_settings_generation_check", sql`${table.forumGeneration} > 0`),
  check("youtube_forum_settings_lifecycle_check", sql`${table.lifecycle} IN ('active', 'disabled', 'cleaning')`),
  check("youtube_forum_settings_active_forum_check", sql`${table.lifecycle} <> 'active' OR ${table.forumChannelId} IS NOT NULL`),
]);

export const youtubeSubscriptions = pgTable("youtube_subscriptions", {
  guildId: varchar("guild_id", { length: 20 }).notNull().references(() => youtubeForumSettings.guildId, { onDelete: "cascade" }),
  channelId: varchar("channel_id", { length: 24 }).notNull().references(() => youtubeChannels.channelId),
  tagId: varchar("tag_id", { length: 20 }),
  ownsTag: boolean("owns_tag").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  initialBackfillCount: integer("initial_backfill_count").notNull().default(10),
  initialImportCompletedAt: timestamp("initial_import_completed_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.channelId] }),
  unique("youtube_subscriptions_guild_tag_unique").on(table.guildId, table.tagId),
  index("youtube_subscriptions_channel_enabled_idx").on(table.channelId, table.enabled),
  check("youtube_subscriptions_backfill_check", sql`${table.initialBackfillCount} BETWEEN 0 AND 15`),
]);

// 'excluded' snapshots the initial remainder; it must not become a live backfill.
export const youtubePublicationIntents = pgTable("youtube_publication_intents", {
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  channelId: varchar("channel_id", { length: 24 }).notNull(),
  videoId: varchar("video_id", { length: 11 }).notNull(),
  forumGeneration: integer("forum_generation").notNull(),
  state: text("state").notNull(),
  mode: text("mode").notNull(),
  threadId: varchar("thread_id", { length: 20 }),
  starterMessageId: varchar("starter_message_id", { length: 20 }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.videoId] }),
  foreignKey({ columns: [table.guildId, table.channelId], foreignColumns: [youtubeSubscriptions.guildId, youtubeSubscriptions.channelId] }).onDelete("cascade"),
  foreignKey({ columns: [table.channelId, table.videoId], foreignColumns: [youtubeVideos.channelId, youtubeVideos.videoId] }),
  check("youtube_publication_intents_state_check", sql`${table.state} IN ('excluded', 'pending', 'in_progress', 'published', 'needs_reconciliation')`),
  check("youtube_publication_intents_mode_check", sql`${table.mode} IN ('initial', 'live', 'backfill')`),
  check("youtube_publication_intents_attempts_check", sql`${table.attempts} >= 0 AND ${table.forumGeneration} > 0`),
  check("youtube_publication_intents_published_check", sql`${table.state} <> 'published' OR (${table.threadId} IS NOT NULL AND ${table.starterMessageId} IS NOT NULL)`),
  index("youtube_publication_intents_guild_state_idx").on(table.guildId, table.state),
]);

export const youtubeVideoPublications = pgTable("youtube_video_publications", {
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  channelId: varchar("channel_id", { length: 24 }).notNull(),
  videoId: varchar("video_id", { length: 11 }).notNull(),
  forumGeneration: integer("forum_generation").notNull(),
  threadId: varchar("thread_id", { length: 20 }).notNull().unique(),
  starterMessageId: varchar("starter_message_id", { length: 20 }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.guildId, table.videoId] }),
  foreignKey({ columns: [table.guildId, table.channelId], foreignColumns: [youtubeSubscriptions.guildId, youtubeSubscriptions.channelId] }).onDelete("cascade"),
  foreignKey({ columns: [table.channelId, table.videoId], foreignColumns: [youtubeVideos.channelId, youtubeVideos.videoId] }),
  check("youtube_video_publications_generation_check", sql`${table.forumGeneration} > 0`),
]);

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
