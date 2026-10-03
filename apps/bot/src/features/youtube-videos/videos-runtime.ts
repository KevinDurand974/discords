import type { Client, ForumChannel } from "discord.js";
import { createVideosApi } from "./videos-api.ts";
import {
  auditVideoPermissions,
  creatorTag,
  getVideoForum,
  provisionVideoForum,
  publishVideo,
} from "./videos-discord.ts";
import { createVideosRepository, type ForumSettings } from "./videos-repository.ts";

const runtimes = new WeakMap<Client, ReturnType<typeof buildRuntime>>();
function buildRuntime(client: Client) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for YouTube videos.");
  const store = createVideosRepository(process.env.DATABASE_URL);
  const api = createVideosApi(
    process.env.YOUTUBE_API_URL || process.env.NEWS_API_URL || "http://localhost:3000",
    process.env.NEWS_INTERNAL_TOKEN,
  );
  async function repairTags(setup: ForumSettings, forum: ForumChannel) {
    const tracked = await store.subscriptions(setup.guildId);
    await tracked.reduce(async (previous, { subscription, creator }) => {
      await previous;
      const bound = (await store.subscriptions(setup.guildId))
        .map((row) => row.subscription.tagId)
        .filter((id): id is string => id !== null);
      const tag = await creatorTag(
        forum,
        creator.displayName,
        creator.channelId,
        subscription.tagId,
        bound,
      );
      await store.repairSubscription(
        setup.guildId,
        subscription,
        tag.id,
        subscription.tagId === tag.id ? subscription.ownsTag : tag.owned,
        setup.forumGeneration,
      );
    }, Promise.resolve());
  }
  async function provision(guildId: string) {
    const guild = await client.guilds.fetch(guildId);
    await store.createSettings(guildId);
    let setup = (await store.get(guildId))!;
    if (setup.lifecycle === "cleaning")
      throw new Error("Cleanup is incomplete; an administrator must finish /videos clean first.");
    if (!setup.ownsForum) throw new Error("Unowned Forums cannot be modified by this feature.");
    let forum = await getVideoForum(guild, setup.forumChannelId);
    if (!forum) {
      if (setup.forumChannelId) {
        await store.resetForum(guildId);
        setup = (await store.get(guildId))!;
      }
      forum = await provisionVideoForum(guild);
      try {
        await store.setForum(guildId, forum.id, setup.forumGeneration);
      } catch (error) {
        try {
          await forum.delete("YouTube setup persistence failed");
        } catch {
          console.error("Orphaned YouTube Forum", { guildId, forumId: forum.id });
        }
        throw error;
      }
      setup = (await store.get(guildId))!;
    }
    await auditVideoPermissions(forum);
    await repairTags(setup, forum);
    return { setup, forum };
  }
  async function publish(setup: ForumSettings) {
    const guild = await client.guilds.fetch(setup.guildId);
    const forum = await getVideoForum(guild, setup.forumChannelId);
    if (!forum) throw new Error("Latest Videos is missing; run /videos add to recreate it.");
    if (!setup.ownsForum) throw new Error("Unowned video Forum cannot be modified.");
    await auditVideoPermissions(forum);
    await repairTags(setup, forum);
    await store.enqueue(setup.guildId, setup.forumGeneration);
    const pending = await store.pending(setup.guildId);
    let published = 0;
    const failures: string[] = [];
    await pending.reduce(async (previous, { intent, video, subscription }) => {
      await previous;
      try {
        if (intent.forumGeneration !== setup.forumGeneration || !subscription.tagId)
          throw new Error("Stale publication mapping.");
        await store.begin(intent);
        const threadId = await publishVideo(
          client,
          setup,
          intent,
          video,
          subscription.tagId,
          (id) => store.checkpoint(intent, id),
        );
        await store.published(intent, threadId);
        published += 1;
      } catch {
        await store.failed(intent);
        failures.push(video.videoId);
      }
    }, Promise.resolve());
    await store.completeInitial(setup.guildId);
    return { published, failures };
  }
  return {
    store,
    async add(guildId: string, input: string, count: number) {
      if (!Number.isInteger(count) || count < 0 || count > 15)
        throw new Error("Backfill count must be between 0 and 15.");
      const resolved = await api.resolve(input);
      return store.withGuild(guildId, async () => {
        const { setup, forum } = await provision(guildId);
        const tracked = await store.subscriptions(guildId);
        const existing = tracked.find(
          (row) => row.subscription.channelId === resolved.channel.channelId,
        );
        if (!existing) {
          const tag = await creatorTag(
            forum,
            resolved.channel.displayName,
            resolved.channel.channelId,
            null,
            tracked.map((row) => row.subscription.tagId).filter((id): id is string => id !== null),
          );
          const newest = [...resolved.videos].sort(
            (a, b) =>
              Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
              b.videoId.localeCompare(a.videoId),
          );
          await store.subscribe(
            guildId,
            resolved.channel.channelId,
            tag.id,
            tag.owned,
            count,
            newest.slice(0, count).map((video) => video.videoId),
            setup.forumGeneration,
          );
        }
        return { ...(await publish(setup)), forumId: forum.id, reused: Boolean(existing) };
      });
    },
    async sync(guildId: string) {
      return store.withGuild(guildId, async () => {
        const setup = await store.get(guildId);
        if (!setup || setup.lifecycle !== "active")
          throw new Error("Videos are not active for this server.");
        return publish(setup);
      });
    },
    async clean(guildId: string, expectedForumId: string | null, generation: number) {
      return store.withGuild(guildId, async () => {
        const setup = await store.get(guildId);
        if (!setup) return;
        if (setup.forumChannelId !== expectedForumId || setup.forumGeneration !== generation)
          throw new Error("Video resources changed; request cleanup confirmation again.");
        if (!setup.ownsForum) throw new Error("Refusing to delete an unowned Forum.");
        await store.cleaning(guildId);
        const guild = await client.guilds.fetch(guildId);
        const forum = await getVideoForum(guild, setup.forumChannelId);
        if (forum) await forum.delete("Administrator-confirmed YouTube cleanup");
        await store.remove(guildId);
      });
    },
  };
}
export function createVideosRuntime(client: Client) {
  let runtime = runtimes.get(client);
  if (!runtime) {
    runtime = buildRuntime(client);
    runtimes.set(client, runtime);
  }
  return runtime;
}
export async function synchronizeVideos(client: Client) {
  if (!client.isReady()) throw new Error("Discord is not ready for video publication.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for video publication.");
  const runtime = createVideosRuntime(client);
  const guildIds = await runtime.store.guildIds();
  const results = await Promise.allSettled(
    guildIds.map(async (guildId) => {
      const result = await runtime.sync(guildId);
      if (result.failures.length)
        throw new Error(`${result.failures.length} video publications failed in ${guildId}.`);
    }),
  );
  if (results.some((result) => result.status === "rejected"))
    throw new Error("YouTube publication is incomplete; failed guilds will be retried.");
}
