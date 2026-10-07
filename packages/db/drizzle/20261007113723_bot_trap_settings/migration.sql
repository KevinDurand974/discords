CREATE TABLE "bot_trap_settings" (
	"guild_id" varchar(20) PRIMARY KEY,
	"channel_id" varchar(20) NOT NULL UNIQUE
);
