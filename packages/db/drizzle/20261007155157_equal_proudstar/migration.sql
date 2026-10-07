CREATE TABLE "reaction_role_messages" (
	"message_id" varchar(20) PRIMARY KEY,
	"guild_id" varchar(20) NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"mappings" jsonb NOT NULL
);
