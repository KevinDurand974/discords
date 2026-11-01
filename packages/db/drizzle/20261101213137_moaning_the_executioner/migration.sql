ALTER TABLE "youtube_subscriptions" ADD COLUMN "content_mode" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "youtube_videos" ADD COLUMN "is_short" boolean;--> statement-breakpoint
ALTER TABLE "youtube_subscriptions" ADD CONSTRAINT "youtube_subscriptions_content_mode_check" CHECK ("content_mode" IN ('all', 'videos', 'shorts'));