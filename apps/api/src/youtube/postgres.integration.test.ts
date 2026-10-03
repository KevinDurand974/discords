import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@discords/db";
import { eq, inArray } from "@discords/db/orm";
import { youtubeChannels, youtubeForumSettings, youtubeSubscriptions, youtubeVideos, youtubePublicationIntents, youtubeVideoPublications } from "@discords/db/schema";
import { createYoutubeReader, createYoutubeStore } from "./repository.ts";
import { createYoutubeIngestion } from "./ingestion.ts";
import { parseYoutubeFeed } from "./rss-parser.ts";
import { YoutubeError, type YoutubeClient } from "./types.ts";
import { CHANNEL_ID, OTHER_CHANNEL_ID, rssEntry, rssFixture, videoId, wrapFeed } from "./fixtures.ts";

const url = process.env.TEST_DATABASE_URL;
const database = url ? createDatabase(url) : undefined;
const guilds = ["91842001", "91842002"];
async function cleanup() {
  if (!database) return;
  await database.db.delete(youtubeForumSettings).where(inArray(youtubeForumSettings.guildId, guilds));
  await database.db.delete(youtubeVideos).where(inArray(youtubeVideos.channelId, [CHANNEL_ID, OTHER_CHANNEL_ID]));
  await database.db.delete(youtubeChannels).where(inArray(youtubeChannels.channelId, [CHANNEL_ID, OTHER_CHANNEL_ID]));
}
if (database) {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await database.pool.end(); });
}

describe.skipIf(!database)("YouTube PostgreSQL ingestion and subscription foundation", () => {
  it("persists all 15 videos, preserves metadata/history and pages tied dates deterministically", async () => {
    const store = createYoutubeStore(database!.db);
    const reader = createYoutubeReader(database!.db);
    const feed = parseYoutubeFeed(rssFixture(), CHANNEL_ID);
    const client: YoutubeClient = { resolve: async () => CHANNEL_ID, feed: async () => feed };
    const ingestion = createYoutubeIngestion(store, client, reader);
    expect((await ingestion.resolve("@heartfulharry2185")).videos).toHaveLength(15);
    await ingestion.resolve(CHANNEL_ID);
    expect((await reader.videos(CHANNEL_ID, 50)).items).toHaveLength(15);
    const first = await reader.videos(CHANNEL_ID, 10);
    expect(first.items).toHaveLength(10);
    expect(first.items[0]?.videoId).toBe(videoId(15));
    expect((await reader.videos(CHANNEL_ID, 10, first.nextCursor!)).items).toHaveLength(5);
    await expect(reader.videos(OTHER_CHANNEL_ID, 10, first.nextCursor!)).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(reader.videos(CHANNEL_ID, 10, "invalid")).rejects.toMatchObject({ code: "invalid_cursor" });
    const tied = parseYoutubeFeed(wrapFeed(rssEntry(1, { published: "2026-10-30T00:00:00Z" }) +
      rssEntry(2, { published: "2026-10-30T00:00:00Z", description: "Updated" })), CHANNEL_ID);
    tied.displayName = "Renamed creator";
    await store.ingest(CHANNEL_ID, undefined, async () => tied);
    expect((await reader.channel(CHANNEL_ID))?.handle).toBe("@heartfulharry2185");
    expect((await reader.channel(CHANNEL_ID))?.displayName).toBe("Renamed creator");
    expect((await reader.videos(CHANNEL_ID, 50)).items).toHaveLength(15);
    const tiedFirst = await reader.videos(CHANNEL_ID, 1);
    expect(tiedFirst.items[0]).toMatchObject({ videoId: videoId(2), description: "Updated" });
    expect((await reader.videos(CHANNEL_ID, 1, tiedFirst.nextCursor!)).items[0]?.videoId).toBe(videoId(1));
    const recovered = createDatabase(url!);
    try { expect((await createYoutubeReader(recovered.db).videos(CHANNEL_ID, 50)).items).toHaveLength(15); }
    finally { await recovered.pool.end(); }
  });
  it("retains valid partial entries without advancing success and persists safe failure checkpoints", async () => {
    const store = createYoutubeStore(database!.db);
    await store.ingest(CHANNEL_ID, undefined, async () => parseYoutubeFeed(rssFixture(1), CHANNEL_ID));
    const [before] = await database!.db.select().from(youtubeChannels).where(eq(youtubeChannels.channelId, CHANNEL_ID));
    await store.ingest(CHANNEL_ID, undefined, async () =>
      parseYoutubeFeed(wrapFeed(rssEntry(2) + rssEntry(3, { published: "bad" })), CHANNEL_ID));
    const [partial] = await database!.db.select().from(youtubeChannels).where(eq(youtubeChannels.channelId, CHANNEL_ID));
    expect(partial?.lastSyncedAt).toEqual(before?.lastSyncedAt);
    expect(partial?.lastError).toBe("incomplete_feed");
    expect((await createYoutubeReader(database!.db).videos(CHANNEL_ID, 50)).items).toHaveLength(2);
    await expect(store.ingest(CHANNEL_ID, undefined, async () => { throw new Error("private-key"); }))
      .rejects.toMatchObject({ code: "upstream_unavailable" });
    const [failed] = await database!.db.select().from(youtubeChannels).where(eq(youtubeChannels.channelId, CHANNEL_ID));
    expect(failed?.lastError).toBe("upstream_unavailable");
    expect(failed?.lastSyncedAt).toEqual(before?.lastSyncedAt);
    expect(failed?.lastAttemptedAt).not.toBeNull();
  });
  it("polls each actively subscribed source once and keeps global history when guild setup is deleted", async () => {
    const db = database!.db;
    const store = createYoutubeStore(db);
    await store.ingest(CHANNEL_ID, undefined, async () => parseYoutubeFeed(rssFixture(1), CHANNEL_ID));
    await store.ingest(OTHER_CHANNEL_ID, undefined, async () => ({ channelId: OTHER_CHANNEL_ID, displayName: "Other", videos: [], rejectedEntries: 0 }));
    await db.insert(youtubeForumSettings).values(guilds.map((guildId) => ({ guildId, forumChannelId: guildId, lifecycle: "active" })));
    await db.insert(youtubeSubscriptions).values(guilds.map((guildId) => ({ guildId, channelId: CHANNEL_ID, tagId: `${guildId}1` })));
    await db.insert(youtubeSubscriptions).values({ guildId: guilds[0]!, channelId: OTHER_CHANNEL_ID, enabled: false });
    expect(await store.trackedChannelIds()).toEqual([CHANNEL_ID]);
    await db.insert(youtubePublicationIntents).values({ guildId: guilds[0]!, channelId: CHANNEL_ID, videoId: videoId(1), forumGeneration: 1, state: "excluded", mode: "initial" });
    await expect(db.insert(youtubePublicationIntents).values({ guildId: guilds[1]!, channelId: CHANNEL_ID, videoId: videoId(1), forumGeneration: 1, state: "invalid", mode: "live" }))
      .rejects.toThrow();
    await expect(db.insert(youtubeSubscriptions).values({ guildId: guilds[0]!, channelId: OTHER_CHANNEL_ID, tagId: `${guilds[0]}1` })
      .onConflictDoUpdate({ target: [youtubeSubscriptions.guildId, youtubeSubscriptions.channelId], set: { tagId: `${guilds[0]}1` } })).rejects.toThrow();
    await expect(db.insert(youtubeVideoPublications).values({ guildId: guilds[0]!, channelId: OTHER_CHANNEL_ID, videoId: videoId(1), forumGeneration: 1, threadId: "111", starterMessageId: "112" }))
      .rejects.toThrow();
    await db.update(youtubeForumSettings).set({ lifecycle: "cleaning" }).where(eq(youtubeForumSettings.guildId, guilds[1]!));
    await db.delete(youtubeForumSettings).where(eq(youtubeForumSettings.guildId, guilds[0]!));
    expect(await store.trackedChannelIds()).toEqual([]);
    expect(await db.select().from(youtubePublicationIntents)).toEqual([]);
    expect((await createYoutubeReader(db).videos(CHANNEL_ID, 50)).items).toHaveLength(1);
  });
  it("excludes concurrent source refresh across separate database connections", async () => {
    const other = createDatabase(url!);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = createYoutubeStore(database!.db).ingest(CHANNEL_ID, undefined, async () => {
      started.resolve(); await release.promise; return parseYoutubeFeed(rssFixture(1), CHANNEL_ID);
    });
    const fetchFeed = vi.fn(async () => parseYoutubeFeed(rssFixture(1), CHANNEL_ID));
    try {
      await started.promise;
      await expect(createYoutubeStore(other.db).ingest(CHANNEL_ID, undefined, fetchFeed)).rejects.toBeInstanceOf(YoutubeError);
      expect(fetchFeed).not.toHaveBeenCalled();
    } finally {
      release.resolve(); await first; await other.pool.end();
    }
  });
});
