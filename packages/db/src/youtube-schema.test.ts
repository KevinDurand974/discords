import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { youtubeChannels, youtubeVideos, youtubeForumSettings, youtubeSubscriptions, youtubePublicationIntents, youtubeVideoPublications } from "./schema.ts";

const columns = (table: Parameters<typeof getTableColumns>[0]) => Object.keys(getTableColumns(table));

describe("YouTube schema boundaries", () => {
  it("separates global history from guild-owned configuration without a creator role", () => {
    expect(getTableName(youtubeChannels)).toBe("youtube_channels");
    expect(getTableName(youtubeVideos)).toBe("youtube_videos");
    expect(columns(youtubeChannels)).not.toContain("guildId");
    expect(columns(youtubeVideos)).not.toContain("guildId");
    expect(columns(youtubeForumSettings)).toContain("forumGeneration");
    expect(columns(youtubeForumSettings).some((name) => /role/i.test(name))).toBe(false);
    expect(columns(youtubeSubscriptions).some((name) => /role/i.test(name))).toBe(false);
    expect(youtubeSubscriptions.initialBackfillCount.default).toBe(10);
    expect(youtubeForumSettings.lifecycle.default).toBe("disabled");
  });
  it("uses subscription/publication uniqueness and cross-source ownership constraints", () => {
    expect(getTableConfig(youtubeSubscriptions).primaryKeys[0]?.columns.map(({ name }) => name)).toEqual(["guild_id", "channel_id"]);
    expect(getTableConfig(youtubeSubscriptions).uniqueConstraints.map(({ name }) => name)).toContain("youtube_subscriptions_guild_tag_unique");
    expect(getTableConfig(youtubeVideoPublications).primaryKeys[0]?.columns.map(({ name }) => name)).toEqual(["guild_id", "video_id"]);
    expect(getTableConfig(youtubeVideoPublications).foreignKeys).toHaveLength(2);
    expect(getTableConfig(youtubePublicationIntents).checks.map(({ name }) => name)).toContain("youtube_publication_intents_state_check");
    expect(columns(youtubePublicationIntents)).toEqual([
      "guildId", "channelId", "videoId", "forumGeneration", "state", "mode", "threadId", "starterMessageId", "attempts", "lastError", "updatedAt",
    ]);
  });
});
