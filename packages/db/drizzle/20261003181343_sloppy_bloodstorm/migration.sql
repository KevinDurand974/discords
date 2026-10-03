ALTER TABLE "netmarble_news_settings" ADD COLUMN "initial_source_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "netmarble_news_settings" ADD COLUMN "initial_source_article_id" integer;--> statement-breakpoint
UPDATE "netmarble_news_settings" AS settings
SET "initial_source_created_at" = baseline."source_created_at",
    "initial_source_article_id" = baseline."source_article_id"
FROM (
  SELECT DISTINCT ON (articles."guild_id")
    articles."guild_id", articles."source_created_at", articles."source_article_id"
  FROM "netmarble_articles" AS articles
  JOIN "netmarble_news_settings" AS settings ON settings."guild_id" = articles."guild_id"
  WHERE settings."initial_import_completed_at" IS NULL
     OR articles."first_seen_at" <= settings."initial_import_completed_at"
  ORDER BY articles."guild_id", articles."source_created_at" DESC, articles."source_article_id" DESC
) AS baseline
WHERE settings."guild_id" = baseline."guild_id";--> statement-breakpoint
DELETE FROM "netmarble_articles" WHERE "sync_state" = 'skipped';--> statement-breakpoint
ALTER TABLE "netmarble_articles" DROP CONSTRAINT "netmarble_articles_sync_state_check", ADD CONSTRAINT "netmarble_articles_sync_state_check" CHECK ("sync_state" = 'published');--> statement-breakpoint
ALTER TABLE "netmarble_articles" DROP CONSTRAINT "netmarble_articles_publication_check", ADD CONSTRAINT "netmarble_articles_publication_check" CHECK ("thread_id" IS NOT NULL AND "published_at" IS NOT NULL);