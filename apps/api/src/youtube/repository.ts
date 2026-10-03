import { and, desc, eq, lt, or, sql } from "@discords/db/orm";
import type { Database } from "@discords/db";
import { youtubeChannels, youtubeForumSettings, youtubeSubscriptions, youtubeVideos } from "@discords/db/schema";
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN, YoutubeError, type YoutubeFeed, type YoutubeReader, type YoutubeVideo } from "./types.ts";

export type YoutubeStore = {
  ingest(channelId: string, handle: string | undefined, fetchFeed: () => Promise<YoutubeFeed>): Promise<YoutubeFeed>;
  trackedChannelIds(): Promise<string[]>;
};

const encodeCursor = (channelId: string, at: Date, id: string) =>
  Buffer.from(JSON.stringify({ channelId, at: at.toISOString(), id })).toString("base64url");

function decodeCursor(cursor: string, channelId: string): { at: Date; id: string } {
  try {
    if (cursor.length > 1024) throw new Error();
    const raw: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!raw || typeof raw !== "object") throw new Error();
    const { channelId: scope, at, id } = raw as Record<string, unknown>;
    if (scope !== channelId || typeof at !== "string" || typeof id !== "string" ||
        !VIDEO_ID_PATTERN.test(id) || !Number.isFinite(Date.parse(at))) throw new Error();
    return { at: new Date(at), id };
  } catch {
    throw new YoutubeError("invalid_cursor", "Invalid cursor.", 400);
  }
}

function toVideo(row: typeof youtubeVideos.$inferSelect): YoutubeVideo {
  return {
    videoId: row.videoId, channelId: row.channelId, sourceEntryId: row.sourceEntryId,
    url: row.url, title: row.title, description: row.description,
    publishedAt: row.publishedAt.toISOString(), sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
  };
}

export function createYoutubeReader(db: Database): YoutubeReader {
  return {
    async channel(channelId) {
      const [row] = await db.select().from(youtubeChannels).where(eq(youtubeChannels.channelId, channelId)).limit(1);
      return row ? {
        channelId: row.channelId, canonicalUrl: row.canonicalUrl, handle: row.handle,
        displayName: row.displayName, lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      } : null;
    },
    async videos(channelId, limit, cursor) {
      if (!CHANNEL_ID_PATTERN.test(channelId) || !Number.isInteger(limit) || limit < 1 || limit > 50)
        throw new YoutubeError("invalid_parameters", "Invalid channel or page size.", 400);
      const after = cursor ? decodeCursor(cursor, channelId) : undefined;
      const rows = await db.select().from(youtubeVideos).where(and(
        eq(youtubeVideos.channelId, channelId),
        after ? or(lt(youtubeVideos.publishedAt, after.at),
          and(eq(youtubeVideos.publishedAt, after.at), lt(youtubeVideos.videoId, after.id))) : undefined,
      )).orderBy(desc(youtubeVideos.publishedAt), desc(youtubeVideos.videoId)).limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toVideo),
        nextCursor: rows.length > limit && last ? encodeCursor(channelId, last.publishedAt, last.videoId) : null,
      };
    },
  };
}

export function createYoutubeStore(db: Database): YoutubeStore {
  return {
    async ingest(channelId, handle, fetchFeed) {
      // Covers source fetch and persistence across API replicas. Lock is released on commit/rollback.
      const result = await db.transaction(async (tx) => {
        const lock = await tx.execute<{ locked: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(71402, hashtext(${channelId})) AS locked`,
        );
        if (!lock.rows[0]?.locked)
          throw new YoutubeError("channel_busy", "This YouTube channel is already synchronizing; retry shortly.", 409);
        const attemptedAt = new Date();
        let feed: YoutubeFeed;
        try {
          feed = await fetchFeed();
        } catch (error) {
          const safeError = error instanceof YoutubeError ? error :
            new YoutubeError("upstream_unavailable", "YouTube feed synchronization failed.");
          await tx.update(youtubeChannels).set({
            lastAttemptedAt: attemptedAt, lastError: safeError.code,
          }).where(eq(youtubeChannels.channelId, channelId));
          return { error: safeError };
        }
        if (feed.channelId !== channelId || feed.videos.some((video) => video.channelId !== channelId))
          throw new YoutubeError("invalid_feed", "YouTube feed channel mismatch.");
        const syncedAt = new Date();
        const metadata = {
          canonicalUrl: `https://www.youtube.com/channel/${channelId}`,
          ...(handle === undefined ? {} : { handle }),
          displayName: feed.displayName,
          lastAttemptedAt: attemptedAt,
          ...(feed.rejectedEntries ? {} : { lastSyncedAt: syncedAt }),
          lastError: feed.rejectedEntries ? "incomplete_feed" : null,
        };
        await tx.insert(youtubeChannels).values({ channelId, ...metadata })
          .onConflictDoUpdate({ target: youtubeChannels.channelId, set: metadata });
        // Channel ownership is immutable for a video; a conflicting source is not reassigned.
        // A transaction has one pg connection; issue writes sequentially (pg@9 requirement).
        for (const video of feed.videos) {
          const values = {
            ...video, publishedAt: new Date(video.publishedAt),
            sourceUpdatedAt: video.sourceUpdatedAt ? new Date(video.sourceUpdatedAt) : null,
            lastSeenAt: syncedAt,
          };
          const updated = await tx.insert(youtubeVideos).values(values).onConflictDoUpdate({
            target: youtubeVideos.videoId,
            set: {
              title: values.title, description: values.description, url: values.url,
              publishedAt: values.publishedAt, sourceUpdatedAt: values.sourceUpdatedAt, lastSeenAt: syncedAt,
            },
            setWhere: eq(youtubeVideos.channelId, channelId),
          }).returning({ videoId: youtubeVideos.videoId });
          if (!updated.length) throw new YoutubeError("source_conflict", "Video is already associated with another channel.", 409);
        }
        return { feed };
      });
      if ("error" in result) throw result.error;
      return result.feed;
    },
    async trackedChannelIds() {
      const rows = await db.selectDistinct({ channelId: youtubeSubscriptions.channelId })
        .from(youtubeSubscriptions).innerJoin(youtubeForumSettings, eq(youtubeSubscriptions.guildId, youtubeForumSettings.guildId))
        .where(and(eq(youtubeSubscriptions.enabled, true), eq(youtubeForumSettings.lifecycle, "active")))
        .orderBy(youtubeSubscriptions.channelId);
      return rows.map(({ channelId }) => channelId);
    },
  };
}
