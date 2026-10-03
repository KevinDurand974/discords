CREATE TABLE "youtube_channels" (
	"channel_id" varchar(24) PRIMARY KEY,
	"canonical_url" text NOT NULL,
	"handle" text,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "youtube_channels_id_check" CHECK ("channel_id" ~ '^UC[A-Za-z0-9_-]{22}$')
);
--> statement-breakpoint
CREATE TABLE "youtube_forum_settings" (
	"guild_id" varchar(20) PRIMARY KEY,
	"forum_channel_id" varchar(20),
	"forum_generation" integer DEFAULT 1 NOT NULL,
	"lifecycle" text DEFAULT 'disabled' NOT NULL,
	"owns_forum" boolean DEFAULT true NOT NULL,
	"last_published_at" timestamp with time zone,
	CONSTRAINT "youtube_forum_settings_generation_check" CHECK ("forum_generation" > 0),
	CONSTRAINT "youtube_forum_settings_lifecycle_check" CHECK ("lifecycle" IN ('active', 'disabled', 'cleaning')),
	CONSTRAINT "youtube_forum_settings_active_forum_check" CHECK ("lifecycle" <> 'active' OR "forum_channel_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "youtube_publication_intents" (
	"guild_id" varchar(20),
	"channel_id" varchar(24) NOT NULL,
	"video_id" varchar(11),
	"forum_generation" integer NOT NULL,
	"state" text NOT NULL,
	"mode" text NOT NULL,
	"thread_id" varchar(20),
	"starter_message_id" varchar(20),
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_publication_intents_pkey" PRIMARY KEY("guild_id","video_id"),
	CONSTRAINT "youtube_publication_intents_state_check" CHECK ("state" IN ('excluded', 'pending', 'in_progress', 'published', 'needs_reconciliation')),
	CONSTRAINT "youtube_publication_intents_mode_check" CHECK ("mode" IN ('initial', 'live', 'backfill')),
	CONSTRAINT "youtube_publication_intents_attempts_check" CHECK ("attempts" >= 0 AND "forum_generation" > 0),
	CONSTRAINT "youtube_publication_intents_published_check" CHECK ("state" <> 'published' OR ("thread_id" IS NOT NULL AND "starter_message_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "youtube_subscriptions" (
	"guild_id" varchar(20),
	"channel_id" varchar(24),
	"tag_id" varchar(20),
	"owns_tag" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"initial_backfill_count" integer DEFAULT 10 NOT NULL,
	"initial_import_completed_at" timestamp with time zone,
	CONSTRAINT "youtube_subscriptions_pkey" PRIMARY KEY("guild_id","channel_id"),
	CONSTRAINT "youtube_subscriptions_guild_tag_unique" UNIQUE("guild_id","tag_id"),
	CONSTRAINT "youtube_subscriptions_backfill_check" CHECK ("initial_backfill_count" BETWEEN 0 AND 15)
);
--> statement-breakpoint
CREATE TABLE "youtube_video_publications" (
	"guild_id" varchar(20),
	"channel_id" varchar(24) NOT NULL,
	"video_id" varchar(11),
	"forum_generation" integer NOT NULL,
	"thread_id" varchar(20) NOT NULL UNIQUE,
	"starter_message_id" varchar(20) NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_video_publications_pkey" PRIMARY KEY("guild_id","video_id"),
	CONSTRAINT "youtube_video_publications_generation_check" CHECK ("forum_generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "youtube_videos" (
	"video_id" varchar(11) PRIMARY KEY,
	"channel_id" varchar(24) NOT NULL,
	"source_entry_id" text NOT NULL UNIQUE,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_videos_channel_video_unique" UNIQUE("channel_id","video_id"),
	CONSTRAINT "youtube_videos_id_check" CHECK ("video_id" ~ '^[A-Za-z0-9_-]{11}$')
);
--> statement-breakpoint
CREATE INDEX "youtube_publication_intents_guild_state_idx" ON "youtube_publication_intents" ("guild_id","state");--> statement-breakpoint
CREATE INDEX "youtube_subscriptions_channel_enabled_idx" ON "youtube_subscriptions" ("channel_id","enabled");--> statement-breakpoint
CREATE INDEX "youtube_videos_channel_date_id_idx" ON "youtube_videos" ("channel_id","published_at" DESC NULLS LAST,"video_id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "youtube_publication_intents" ADD CONSTRAINT "youtube_publication_intents_RWwAZRz1RtDZ_fkey" FOREIGN KEY ("guild_id","channel_id") REFERENCES "youtube_subscriptions"("guild_id","channel_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "youtube_publication_intents" ADD CONSTRAINT "youtube_publication_intents_R5F5KLvl4fmp_fkey" FOREIGN KEY ("channel_id","video_id") REFERENCES "youtube_videos"("channel_id","video_id");--> statement-breakpoint
ALTER TABLE "youtube_subscriptions" ADD CONSTRAINT "youtube_subscriptions_nMBvq1UyipJ4_fkey" FOREIGN KEY ("guild_id") REFERENCES "youtube_forum_settings"("guild_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "youtube_subscriptions" ADD CONSTRAINT "youtube_subscriptions_N8R2yMta9n9T_fkey" FOREIGN KEY ("channel_id") REFERENCES "youtube_channels"("channel_id");--> statement-breakpoint
ALTER TABLE "youtube_video_publications" ADD CONSTRAINT "youtube_video_publications_J6J968uIi5PC_fkey" FOREIGN KEY ("guild_id","channel_id") REFERENCES "youtube_subscriptions"("guild_id","channel_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "youtube_video_publications" ADD CONSTRAINT "youtube_video_publications_2YI8vAsiUWcG_fkey" FOREIGN KEY ("channel_id","video_id") REFERENCES "youtube_videos"("channel_id","video_id");--> statement-breakpoint
ALTER TABLE "youtube_videos" ADD CONSTRAINT "youtube_videos_channel_id_youtube_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "youtube_channels"("channel_id");