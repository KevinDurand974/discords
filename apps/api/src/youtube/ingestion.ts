import { parseChannelInput } from "./channel-url.ts";
import type { YoutubeStore } from "./repository.ts";
import { YoutubeError, type YoutubeClient, type YoutubeReader } from "./types.ts";

export type YoutubeSyncOutcome = {
  channelId: string;
  ingested?: number;
  rejectedEntries?: number;
  error?: string;
};
export type YoutubeSyncResult = { complete: boolean; results: YoutubeSyncOutcome[] };

export function createYoutubeIngestion(store: YoutubeStore, client: YoutubeClient, reader: YoutubeReader) {
  async function ingest(channelId: string, handle?: string) {
    return store.ingest(channelId, handle, () => client.feed(channelId));
  }
  return {
    async resolve(value: string) {
      const input = parseChannelInput(value);
      const channelId = await client.resolve(input);
      const feed = await ingest(channelId, input.kind === "handle" ? input.handle : undefined);
      if (feed.rejectedEntries)
        throw new YoutubeError("incomplete_feed", "Some YouTube feed entries are invalid; retry before adding this creator.");
      const channel = await reader.channel(channelId);
      if (!channel) throw new YoutubeError("storage_unavailable", "YouTube channel could not be read after ingestion.", 503);
      const videos = [...feed.videos].sort((a, b) =>
        b.publishedAt.localeCompare(a.publishedAt) || b.videoId.localeCompare(a.videoId));
      return { channel, videos };
    },
    async syncAll(): Promise<YoutubeSyncResult> {
      const channelIds = await store.trackedChannelIds();
      const results: YoutubeSyncOutcome[] = [];
      // Small batches bound both upstream concurrency and transactions held during RSS requests.
      for (let offset = 0; offset < channelIds.length; offset += 3) {
        const batch = await Promise.all(channelIds.slice(offset, offset + 3).map(async (channelId) => {
          try {
            const feed = await ingest(channelId);
            return {
              channelId, ingested: feed.videos.length, rejectedEntries: feed.rejectedEntries,
              ...(feed.rejectedEntries ? { error: "incomplete_feed" } : {}),
            };
          } catch (error) {
            return { channelId, error: error instanceof YoutubeError ? error.code : "ingestion_failed" };
          }
        }));
        results.push(...batch);
      }
      return { complete: results.every((result) => !result.error), results };
    },
  };
}

export type YoutubeIngestion = ReturnType<typeof createYoutubeIngestion>;
