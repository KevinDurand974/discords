CREATE TABLE "welcome_settings" (
	"guild_id" varchar(20) PRIMARY KEY,
	"channel_id" varchar(20) NOT NULL,
	"arrival_message" varchar(1000) NOT NULL,
	"departure_message" varchar(1000) NOT NULL
);
