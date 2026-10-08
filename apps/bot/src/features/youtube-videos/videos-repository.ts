import { UserFacingError } from "@/core/errors.ts";
import { createDatabase, type Database } from "@discords/db";
import { and, asc, desc, eq, inArray, sql } from "@discords/db/orm";
import {
  youtubeChannels,
  youtubeForumSettings as settings,
  youtubeSubscriptions as subscriptions,
  youtubeVideos as videos,
  youtubePublicationIntents as intents,
  youtubeVideoPublications as publications,
} from "@discords/db/schema";

export type Video = typeof videos.$inferSelect;
export type ForumSettings = typeof settings.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Intent = typeof intents.$inferSelect;

export function createVideosRepository(url: string) {
  const database = createDatabase(url);
  const db = database.db;
  const scope = (guildId: string) => eq(settings.guildId, guildId);
  return {
    async withGuild<T>(guildId: string, work: () => Promise<T>): Promise<T> {
      const connection = await database.pool.connect();
      let locked = false;
      try {
        const result = await connection.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(71403, hashtext($1)) AS locked",
          [guildId],
        );
        locked = result.rows[0]?.locked ?? false;
        if (!locked)
          throw new UserFacingError("YouTube is already being updated. Try again shortly.");
        return await work();
      } finally {
        try {
          if (locked)
            await connection.query("SELECT pg_advisory_unlock(71403, hashtext($1))", [guildId]);
        } finally {
          connection.release();
        }
      }
    },
    async get(guildId: string) {
      return (await db.select().from(settings).where(scope(guildId)).limit(1))[0] ?? null;
    },
    async guildIds() {
      return (await db.select().from(settings).where(eq(settings.lifecycle, "active"))).map(
        (row) => row.guildId,
      );
    },
    async subscriptions(guildId: string) {
      return db
        .select({ subscription: subscriptions, creator: youtubeChannels })
        .from(subscriptions)
        .innerJoin(youtubeChannels, eq(subscriptions.channelId, youtubeChannels.channelId))
        .where(eq(subscriptions.guildId, guildId))
        .orderBy(youtubeChannels.displayName);
    },
    async createSettings(guildId: string) {
      await db.insert(settings).values({ guildId }).onConflictDoNothing();
    },
    async setForum(guildId: string, forumChannelId: string, generation: number, ownsForum = true) {
      await db
        .update(settings)
        .set({ forumChannelId, forumGeneration: generation, ownsForum, lifecycle: "active" })
        .where(scope(guildId));
    },
    async resetForum(guildId: string) {
      await db.transaction(async (tx) => {
        await tx.delete(publications).where(eq(publications.guildId, guildId));
        await tx.delete(intents).where(eq(intents.guildId, guildId));
        await tx
          .update(subscriptions)
          .set({ tagId: null, initialImportCompletedAt: null })
          .where(eq(subscriptions.guildId, guildId));
        await tx
          .update(settings)
          .set({
            forumChannelId: null,
            lifecycle: "disabled",
            forumGeneration: sql`${settings.forumGeneration} + 1`,
          })
          .where(scope(guildId));
      });
    },
    async subscribe(
      guildId: string,
      channelId: string,
      tagId: string,
      ownsTag: boolean,
      count: number,
      selectedIds: string[],
      generation: number,
    ) {
      await db.transaction(async (tx) => {
        await tx
          .insert(subscriptions)
          .values({ guildId, channelId, tagId, ownsTag, initialBackfillCount: count });
        await initialize(tx, guildId, channelId, selectedIds, generation);
      });
    },
    async repairSubscription(
      guildId: string,
      subscription: Subscription,
      tagId: string,
      ownsTag: boolean,
      generation: number,
    ) {
      await db.transaction(async (tx) => {
        await tx
          .update(subscriptions)
          .set({ tagId, ownsTag })
          .where(
            and(
              eq(subscriptions.guildId, guildId),
              eq(subscriptions.channelId, subscription.channelId),
            ),
          );
        const initialized = await tx
          .select({ id: intents.videoId })
          .from(intents)
          .where(and(eq(intents.guildId, guildId), eq(intents.channelId, subscription.channelId)))
          .limit(1);
        if (!subscription.initialImportCompletedAt && !initialized.length) {
          const newest = await tx
            .select({ id: videos.videoId })
            .from(videos)
            .where(eq(videos.channelId, subscription.channelId))
            .orderBy(desc(videos.publishedAt), desc(videos.videoId))
            .limit(subscription.initialBackfillCount);
          await initialize(
            tx,
            guildId,
            subscription.channelId,
            newest.map((row) => row.id),
            generation,
          );
        }
      });
    },
    async enqueue(guildId: string, generation: number) {
      // Every stored source not in the persisted initial baseline is eligible, regardless of its publication date.
      await db.execute(sql`INSERT INTO youtube_publication_intents (guild_id, channel_id, video_id, forum_generation, state, mode)
        SELECT s.guild_id, v.channel_id, v.video_id, ${generation}, 'pending', 'live'
        FROM youtube_subscriptions s JOIN youtube_videos v ON v.channel_id = s.channel_id
        WHERE s.guild_id = ${guildId} AND s.enabled = true ON CONFLICT DO NOTHING`);
    },
    async pending(guildId: string) {
      return db
        .select({ intent: intents, video: videos, subscription: subscriptions })
        .from(intents)
        .innerJoin(videos, eq(intents.videoId, videos.videoId))
        .innerJoin(
          subscriptions,
          and(
            eq(intents.guildId, subscriptions.guildId),
            eq(intents.channelId, subscriptions.channelId),
          ),
        )
        .where(
          and(
            eq(intents.guildId, guildId),
            eq(subscriptions.enabled, true),
            inArray(intents.state, ["pending", "in_progress", "needs_reconciliation"]),
          ),
        )
        .orderBy(asc(videos.publishedAt), asc(videos.videoId));
    },
    async begin(intent: Intent) {
      await db
        .update(intents)
        .set({
          state: "in_progress",
          attempts: sql`${intents.attempts} + 1`,
          updatedAt: new Date(),
          lastError: null,
        })
        .where(and(eq(intents.guildId, intent.guildId), eq(intents.videoId, intent.videoId)));
    },
    async checkpoint(intent: Intent, threadId: string) {
      await db
        .update(intents)
        .set({ threadId, starterMessageId: threadId, updatedAt: new Date() })
        .where(and(eq(intents.guildId, intent.guildId), eq(intents.videoId, intent.videoId)));
    },
    async failed(intent: Intent) {
      await db
        .update(intents)
        .set({
          state: "needs_reconciliation",
          lastError: "discord_publication_failed",
          updatedAt: new Date(),
        })
        .where(and(eq(intents.guildId, intent.guildId), eq(intents.videoId, intent.videoId)));
    },
    async published(intent: Intent, threadId: string) {
      await db.transaction(async (tx) => {
        await tx
          .insert(publications)
          .values({
            guildId: intent.guildId,
            channelId: intent.channelId,
            videoId: intent.videoId,
            forumGeneration: intent.forumGeneration,
            threadId,
            starterMessageId: threadId,
          })
          .onConflictDoNothing();
        await tx
          .update(intents)
          .set({
            state: "published",
            threadId,
            starterMessageId: threadId,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(and(eq(intents.guildId, intent.guildId), eq(intents.videoId, intent.videoId)));
        await tx.update(settings).set({ lastPublishedAt: new Date() }).where(scope(intent.guildId));
      });
    },
    async completeInitial(guildId: string) {
      await db.execute(sql`UPDATE youtube_subscriptions s SET initial_import_completed_at = now()
        WHERE s.guild_id = ${guildId} AND s.initial_import_completed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM youtube_publication_intents i WHERE i.guild_id = s.guild_id AND i.channel_id = s.channel_id AND i.mode = 'initial' AND i.state <> 'published')`);
    },
    async counts(guildId: string) {
      const result = await db
        .select({ state: intents.state, count: sql<number>`count(*)::int` })
        .from(intents)
        .where(eq(intents.guildId, guildId))
        .groupBy(intents.state);
      const labels: Record<string, string> = {
        pending: "Waiting to publish",
        in_progress: "Publishing",
        needs_reconciliation: "Needs retry",
        published: "Published",
        suppressed: "Removed",
      };
      return (
        result.map((row) => `${labels[row.state] ?? "Other videos"}: ${row.count}`).join(", ") ||
        "No videos yet."
      );
    },
    async publicationThreads(guildId: string, channelId?: string) {
      const rows = await db
        .select({ threadId: intents.threadId })
        .from(intents)
        .where(
          channelId
            ? and(eq(intents.guildId, guildId), eq(intents.channelId, channelId))
            : eq(intents.guildId, guildId),
        );
      return rows.flatMap((row) => (row.threadId ? [row.threadId] : []));
    },
    async cleaning(guildId: string) {
      await db.update(settings).set({ lifecycle: "cleaning" }).where(scope(guildId));
    },
    async excludeVideos(guildId: string, channelId?: string) {
      const intentScope = channelId
        ? and(eq(intents.guildId, guildId), eq(intents.channelId, channelId))
        : eq(intents.guildId, guildId);
      const publicationScope = channelId
        ? and(eq(publications.guildId, guildId), eq(publications.channelId, channelId))
        : eq(publications.guildId, guildId);
      await db.transaction(async (tx) => {
        // Snapshot even unqueued sources so the next scheduled sync cannot repost them.
        await tx.execute(sql`INSERT INTO youtube_publication_intents (guild_id, channel_id, video_id, forum_generation, state, mode)
          SELECT s.guild_id, v.channel_id, v.video_id, f.forum_generation, 'excluded', 'live'
          FROM youtube_subscriptions s JOIN youtube_videos v ON v.channel_id = s.channel_id
          JOIN youtube_forum_settings f ON f.guild_id = s.guild_id
          WHERE s.guild_id = ${guildId} AND (${channelId ?? null}::text IS NULL OR s.channel_id = ${channelId ?? null})
          ON CONFLICT DO NOTHING`);
        await tx.delete(publications).where(publicationScope);
        await tx
          .update(intents)
          .set({
            state: "excluded",
            mode: "live",
            threadId: null,
            starterMessageId: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(intentScope);
        await tx
          .update(subscriptions)
          .set({ initialImportCompletedAt: new Date() })
          .where(
            channelId
              ? and(eq(subscriptions.guildId, guildId), eq(subscriptions.channelId, channelId))
              : eq(subscriptions.guildId, guildId),
          );
      });
    },
    async removeCreator(guildId: string, channelId: string) {
      await db
        .delete(subscriptions)
        .where(and(eq(subscriptions.guildId, guildId), eq(subscriptions.channelId, channelId)));
    },
    async remove(guildId: string) {
      await db.delete(settings).where(scope(guildId));
    },
    close: () => database.pool.end(),
  };
}

async function initialize(
  db: Pick<Database, "execute">,
  guildId: string,
  channelId: string,
  selectedIds: string[],
  generation: number,
) {
  await db.execute(sql`INSERT INTO youtube_publication_intents (guild_id, channel_id, video_id, forum_generation, state, mode)
    SELECT ${guildId}, channel_id, video_id, ${generation}, CASE WHEN video_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(selectedIds)}::jsonb)) THEN 'pending' ELSE 'excluded' END,
      CASE WHEN video_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(selectedIds)}::jsonb)) THEN 'initial' ELSE 'live' END
    FROM youtube_videos WHERE channel_id = ${channelId} ON CONFLICT DO NOTHING`);
}
export type VideosRepository = ReturnType<typeof createVideosRepository>;
