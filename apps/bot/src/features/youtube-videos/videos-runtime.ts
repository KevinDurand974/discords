import type { Client, ForumChannel } from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import { createVideosApi } from "./videos-api.ts";
import {
  auditVideoPermissions,
  creatorTag,
  checkVideoPermissions,
  deleteVideoPosts,
  getVideoForum,
  provisionVideoForum,
  publishVideo,
} from "./videos-discord.ts";
import {
  createVideosRepository,
  type ForumSettings,
  type VideosRepository,
} from "./videos-repository.ts";

export type CleanupMode = "videos" | "resources";

const runtimes = new WeakMap<Client, ReturnType<typeof buildRuntime>>();
function buildRuntime(client: Client) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for YouTube videos.");
  const store = createVideosRepository(process.env.DATABASE_URL);
  const api = createVideosApi(
    process.env.YOUTUBE_API_URL || process.env.NEWS_API_URL || "http://localhost:3000",
    process.env.NEWS_INTERNAL_TOKEN,
  );
  return buildVideosRuntime(client, store, api);
}
export function buildVideosRuntime(
  client: Client,
  store: VideosRepository,
  api: ReturnType<typeof createVideosApi>,
) {
  async function permissions(setup: ForumSettings, forum: ForumChannel) {
    if (setup.ownsForum) await auditVideoPermissions(forum);
    else await checkVideoPermissions(forum);
  }
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
      throw new UserFacingError("Ask an administrator to finish /youtube clean first.");
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
    await permissions(setup, forum);
    await repairTags(setup, forum);
    return { setup, forum };
  }
  async function publish(setup: ForumSettings) {
    const guild = await client.guilds.fetch(setup.guildId);
    const forum = await getVideoForum(guild, setup.forumChannelId);
    if (!forum) throw new UserFacingError("The YouTube Forum is missing. Run /youtube setup.");
    await permissions(setup, forum);
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
    async setup(guildId: string) {
      return store.withGuild(guildId, () => provision(guildId));
    },
    async creatorTags(guildId: string) {
      const setup = await store.get(guildId);
      if (!setup) return [];
      const guild = await client.guilds.fetch(guildId);
      const forum = await getVideoForum(guild, setup.forumChannelId);
      const tracked = await store.subscriptions(guildId);
      // Retain saved IDs in suggestions during an interrupted tag cleanup.
      return tracked.flatMap(({ subscription, creator }) =>
        subscription.tagId
          ? [
              {
                id: subscription.tagId,
                name:
                  forum?.availableTags.find((tag) => tag.id === subscription.tagId)?.name ??
                  creator.displayName,
              },
            ]
          : [],
      );
    },
    async add(guildId: string, input: string, count: number, forumId: string) {
      if (!Number.isInteger(count) || count < 0 || count > 15)
        throw new UserFacingError("Backfill count must be between 0 and 15.");
      const resolved = await api.resolve(input);
      return store.withGuild(guildId, async () => {
        const guild = await client.guilds.fetch(guildId);
        const forum = await getVideoForum(guild, forumId);
        if (!forum || forum.guildId !== guildId)
          throw new UserFacingError("Choose a Forum channel in this server.");
        let setup = await store.get(guildId);
        if (setup?.lifecycle === "cleaning")
          throw new UserFacingError("Finish /youtube clean before adding a creator.");
        const tracked = await store.subscriptions(guildId);
        if (setup?.forumChannelId !== forum.id) {
          if (tracked.length)
            throw new UserFacingError(
              "A YouTube Forum is already configured. Use /youtube clean before changing it.",
            );
          await checkVideoPermissions(forum);
          await store.createSettings(guildId);
          if (setup?.forumChannelId) await store.resetForum(guildId);
          setup = (await store.get(guildId))!;
          await store.setForum(guildId, forum.id, setup.forumGeneration, false);
          setup = (await store.get(guildId))!;
        }
        if (!setup || setup.lifecycle !== "active")
          throw new UserFacingError("Run /youtube setup first.");
        await permissions(setup, forum);
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
        if (!setup) throw new UserFacingError("YouTube is not configured. Run /youtube setup.");
        if (setup.lifecycle !== "active")
          throw new UserFacingError(
            "YouTube publishing is paused. Finish /youtube clean before publishing again.",
          );
        return publish(setup);
      });
    },
    async clean(
      guildId: string,
      expectedForumId: string | null,
      generation: number,
      mode: CleanupMode,
      tagId?: string,
    ) {
      return store.withGuild(guildId, async () => {
        const setup = await store.get(guildId);
        if (!setup) return;
        if (setup.forumChannelId !== expectedForumId || setup.forumGeneration !== generation)
          throw new Error("Video resources changed; request cleanup confirmation again.");
        const tracked = await store.subscriptions(guildId);
        const selected = tagId
          ? tracked.find((row) => row.subscription.tagId === tagId)
          : undefined;
        if (tagId && !selected)
          throw new Error("Creator tag changed; request cleanup confirmation again.");
        const guild = await client.guilds.fetch(guildId);
        const forum = await getVideoForum(guild, setup.forumChannelId);
        await store.cleaning(guildId);
        if (mode === "resources" && !tagId && setup.ownsForum) {
          if (forum) await forum.delete("Administrator-confirmed YouTube cleanup");
          await store.remove(guildId);
          return;
        }
        if (forum)
          await deleteVideoPosts(
            forum,
            tagId,
            new Set(await store.publicationThreads(guildId, selected?.subscription.channelId)),
          );
        if (mode === "resources") {
          const removed = selected ? [selected] : tracked;
          const ownedTags = new Set(
            removed.filter((row) => row.subscription.ownsTag).map((row) => row.subscription.tagId),
          );
          if (forum && forum.availableTags.some((tag) => ownedTags.has(tag.id))) {
            await forum.setAvailableTags(
              forum.availableTags.filter((tag) => !ownedTags.has(tag.id)),
            );
          }
          if (selected) await store.removeCreator(guildId, selected.subscription.channelId);
          else {
            await store.remove(guildId);
            return;
          }
        } else {
          await store.excludeVideos(guildId, selected?.subscription.channelId);
        }
        if (forum) await store.setForum(guildId, forum.id, setup.forumGeneration, setup.ownsForum);
        else await store.resetForum(guildId);
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
