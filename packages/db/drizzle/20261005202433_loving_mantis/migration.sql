CREATE TABLE "ticket_closures" (
	"channel_id" varchar(20) PRIMARY KEY,
	"guild_id" varchar(20) NOT NULL,
	"owner_id" varchar(20) NOT NULL,
	"requested_by" varchar(20) NOT NULL,
	"delete_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ticket_closures_due_idx" ON "ticket_closures" ("delete_at");