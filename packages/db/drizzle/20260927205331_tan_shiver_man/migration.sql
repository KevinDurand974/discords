CREATE TABLE "netmarble_articles" (
	"guild_id" varchar(20),
	"source_article_id" integer,
	"menu_seq" integer NOT NULL,
	"source_created_at" timestamp with time zone NOT NULL,
	"sync_state" text NOT NULL,
	"thread_id" varchar(20) CONSTRAINT "netmarble_articles_thread_id_unique" UNIQUE,
	"is_source_pinned" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "netmarble_articles_pkey" PRIMARY KEY("guild_id","source_article_id"),
	CONSTRAINT "netmarble_articles_sync_state_check" CHECK ("sync_state" IN ('published', 'skipped')),
	CONSTRAINT "netmarble_articles_publication_check" CHECK (("sync_state" = 'published' AND "thread_id" IS NOT NULL AND "published_at" IS NOT NULL) OR ("sync_state" = 'skipped' AND "thread_id" IS NULL AND "published_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "netmarble_news_categories" (
	"guild_id" varchar(20),
	"menu_seq" integer,
	"tag_id" varchar(20) NOT NULL,
	"notification_role_id" varchar(20) NOT NULL,
	CONSTRAINT "netmarble_news_categories_pkey" PRIMARY KEY("guild_id","menu_seq")
);
--> statement-breakpoint
CREATE TABLE "netmarble_news_settings" (
	"guild_id" varchar(20) PRIMARY KEY,
	"forum_channel_id" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"poll_interval_minutes" integer DEFAULT 30 NOT NULL,
	"initial_import_mode" text DEFAULT 'backfill' NOT NULL,
	CONSTRAINT "netmarble_news_settings_poll_interval_check" CHECK ("poll_interval_minutes" > 0),
	CONSTRAINT "netmarble_news_settings_import_mode_check" CHECK ("initial_import_mode" IN ('backfill', 'future_only'))
);
--> statement-breakpoint
CREATE TABLE "news_categories" (
	"menu_seq" integer PRIMARY KEY,
	"name" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "news_categories_menu_seq_check" CHECK ("menu_seq" IN (1, 13, 14, 32, 46))
);
--> statement-breakpoint
CREATE TABLE "source_article_media" (
	"article_id" integer,
	"position" integer,
	"original_url" text NOT NULL,
	"media_type" text,
	"filename" text,
	CONSTRAINT "source_article_media_pkey" PRIMARY KEY("article_id","position"),
	CONSTRAINT "source_article_media_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "source_articles" (
	"id" integer PRIMARY KEY,
	"menu_seq" integer NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body_html" text,
	"thumbnail_url" text,
	"canonical_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone,
	"is_source_pinned" boolean DEFAULT false NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "netmarble_articles" ADD CONSTRAINT "netmarble_articles_8xOa7mup0VOf_fkey" FOREIGN KEY ("guild_id") REFERENCES "netmarble_news_settings"("guild_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "netmarble_articles" ADD CONSTRAINT "netmarble_articles_source_article_id_source_articles_id_fkey" FOREIGN KEY ("source_article_id") REFERENCES "source_articles"("id");--> statement-breakpoint
ALTER TABLE "netmarble_articles" ADD CONSTRAINT "netmarble_articles_menu_seq_news_categories_menu_seq_fkey" FOREIGN KEY ("menu_seq") REFERENCES "news_categories"("menu_seq");--> statement-breakpoint
ALTER TABLE "netmarble_news_categories" ADD CONSTRAINT "netmarble_news_categories_wk0FZ4hZurC2_fkey" FOREIGN KEY ("guild_id") REFERENCES "netmarble_news_settings"("guild_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "netmarble_news_categories" ADD CONSTRAINT "netmarble_news_categories_v0glLGw6YzdU_fkey" FOREIGN KEY ("menu_seq") REFERENCES "news_categories"("menu_seq");--> statement-breakpoint
ALTER TABLE "source_article_media" ADD CONSTRAINT "source_article_media_article_id_source_articles_id_fkey" FOREIGN KEY ("article_id") REFERENCES "source_articles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_articles" ADD CONSTRAINT "source_articles_menu_seq_news_categories_menu_seq_fkey" FOREIGN KEY ("menu_seq") REFERENCES "news_categories"("menu_seq");
--> statement-breakpoint
INSERT INTO "news_categories" ("menu_seq", "name") VALUES
  (1, 'Official News'), (13, 'Developer Notes'), (14, 'Updates'),
  (32, 'Notices'), (46, 'Hunter: Origin');