import { describe, expect, it, vi } from "vitest";
import { createYoutubeIngestion } from "./ingestion.ts";
import { parseYoutubeFeed } from "./rss-parser.ts";
import type { YoutubeStore } from "./repository.ts";
import { YoutubeError, type YoutubeClient, type YoutubeReader } from "./types.ts";
import { CHANNEL_ID, OTHER_CHANNEL_ID, rssFixture } from "./fixtures.ts";

function setup() {
  const feed = parseYoutubeFeed(rssFixture(), CHANNEL_ID);
  const store: YoutubeStore = {
    ingest: vi.fn(async (_id, _handle, fetchFeed) => fetchFeed()),
    trackedChannelIds: vi.fn(async () => [CHANNEL_ID]),
  };
  const client: YoutubeClient = {
    resolve: vi.fn(async () => CHANNEL_ID),
    feed: vi.fn(async () => feed),
  };
  const reader: YoutubeReader = {
    channel: vi.fn(async () => ({ channelId: CHANNEL_ID, displayName: feed.displayName,
      canonicalUrl: `https://www.youtube.com/channel/${CHANNEL_ID}`, handle: "@creator", lastSyncedAt: null })),
    videos: vi.fn(async () => ({ items: feed.videos, nextCursor: null })),
  };
  return { store, client, reader, feed, ingestion: createYoutubeIngestion(store, client, reader) };
}

describe("YouTube ingestion coordination", () => {
  it("validates before work, stores the whole initial feed and returns newest-first snapshot", async () => {
    const { store, client, ingestion } = setup();
    await expect(ingestion.resolve("https://evil.test/@creator")).rejects.toMatchObject({ code: "invalid_channel_input" });
    expect(client.resolve).not.toHaveBeenCalled();
    const result = await ingestion.resolve("@creator");
    expect(result.videos).toHaveLength(15);
    expect(result.videos[0]?.title).toBe("Guide 15");
    expect(store.ingest).toHaveBeenCalledWith(CHANNEL_ID, "@creator", expect.any(Function));
  });
  it("does not use Google resolution during recurring polling", async () => {
    const { client, ingestion } = setup();
    expect(await ingestion.syncAll()).toEqual({ complete: true, results: [{
      channelId: CHANNEL_ID, ingested: 15, rejectedEntries: 0,
    }] });
    expect(client.resolve).not.toHaveBeenCalled();
  });
  it("keeps healthy channels progressing and sanitizes errors", async () => {
    const { store, client, feed, ingestion } = setup();
    vi.mocked(store.trackedChannelIds).mockResolvedValue([OTHER_CHANNEL_ID, CHANNEL_ID]);
    vi.mocked(client.feed).mockImplementation(async (id) => {
      if (id === OTHER_CHANNEL_ID) throw new Error("private-key and internal details");
      return feed;
    });
    expect(await ingestion.syncAll()).toEqual({ complete: false, results: [
      { channelId: OTHER_CHANNEL_ID, error: "ingestion_failed" },
      { channelId: CHANNEL_ID, ingested: 15, rejectedEntries: 0 },
    ] });
  });
  it("reports partial ingestion and rejects incomplete initial imports", async () => {
    const { client, feed, ingestion } = setup();
    vi.mocked(client.feed).mockResolvedValue({ ...feed, rejectedEntries: 1 });
    await expect(ingestion.resolve(CHANNEL_ID)).rejects.toMatchObject({ code: "incomplete_feed" });
    expect((await ingestion.syncAll()).results[0]).toMatchObject({ error: "incomplete_feed", rejectedEntries: 1 });
  });
  it("preserves safe upstream error codes and does not poll untracked sources", async () => {
    const { store, client, ingestion } = setup();
    vi.mocked(client.feed).mockRejectedValue(new YoutubeError("channel_busy", "Retry", 409));
    expect((await ingestion.syncAll()).results[0]?.error).toBe("channel_busy");
    vi.mocked(store.trackedChannelIds).mockResolvedValue([]);
    vi.mocked(client.feed).mockClear();
    expect(await ingestion.syncAll()).toEqual({ complete: true, results: [] });
    expect(client.feed).not.toHaveBeenCalled();
  });
});
