import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { buildVideosRuntime } from "./videos-runtime.ts";
import type { ForumSettings, VideosRepository } from "./videos-repository.ts";
import type { createVideosApi } from "./videos-api.ts";

const discord = vi.hoisted(() => ({
  auditVideoPermissions: vi.fn(),
  checkVideoPermissions: vi.fn(),
  creatorTag: vi.fn(),
  getVideoForum: vi.fn(),
  provisionVideoForum: vi.fn(),
  publishVideo: vi.fn(),
  deleteVideoPosts: vi.fn(),
}));
vi.mock("./videos-discord.ts", () => discord);
beforeEach(() => {
  vi.resetAllMocks();
});
const creator = (channelId: string, tagId: string) => ({
  creator: { channelId, displayName: channelId },
  subscription: { channelId, tagId, ownsTag: true, initialImportCompletedAt: new Date() },
});
function fixture(ownsForum = true) {
  let setup: ForumSettings | null = {
    guildId: "guild",
    forumChannelId: "forum",
    forumGeneration: 1,
    ownsForum,
    lifecycle: "active",
    lastPublishedAt: null,
  };
  const forum = {
    id: "forum",
    guildId: "guild",
    availableTags: [
      { id: "tag-a", name: "Creator A" },
      { id: "tag-b", name: "Creator B" },
      { id: "unrelated", name: "Other" },
    ],
    delete: vi.fn(),
    setAvailableTags: vi.fn(),
  };
  const store = {
    get: vi.fn(async () => setup),
    withGuild: vi.fn(async (_id: string, work: () => Promise<unknown>) => work()),
    createSettings: vi.fn(async () => {
      setup ??= {
        guildId: "guild",
        forumChannelId: null,
        forumGeneration: 1,
        lifecycle: "disabled",
        ownsForum: true,
        lastPublishedAt: null,
      };
    }),
    setForum: vi.fn(async (_id: string, id: string, generation: number, owned = true) => {
      setup = {
        ...setup!,
        forumChannelId: id,
        forumGeneration: generation,
        lifecycle: "active",
        ownsForum: owned,
      };
    }),
    resetForum: vi.fn(),
    subscriptions: vi.fn(async () => [
      creator("creator-a", "tag-a"),
      creator("creator-b", "tag-b"),
    ]),
    subscribe: vi.fn(),
    repairSubscription: vi.fn(),
    enqueue: vi.fn(),
    pending: vi.fn(async () => []),
    completeInitial: vi.fn(),
    cleaning: vi.fn(async () => {
      if (setup) setup.lifecycle = "cleaning";
    }),
    publicationThreads: vi.fn(async () => ["thread"]),
    excludeVideos: vi.fn(),
    removeCreator: vi.fn(),
    remove: vi.fn(),
  };
  const client = { guilds: { fetch: vi.fn(async () => ({ id: "guild" })) } } as unknown as Client;
  const api = {
    resolve: vi.fn(async () => ({
      channel: { channelId: "creator-a", displayName: "Creator A" },
      videos: [],
    })),
  } satisfies ReturnType<typeof createVideosApi>;
  discord.getVideoForum.mockImplementation(async (_guild, id: string | null) =>
    id === forum.id ? forum : null,
  );
  discord.provisionVideoForum.mockResolvedValue(forum);
  discord.creatorTag.mockResolvedValue({ id: "tag-a", owned: true });
  const runtime = buildVideosRuntime(client, store as unknown as VideosRepository, api);
  return {
    runtime,
    store,
    forum,
    api,
    clearSetup: () => {
      setup = null;
    },
  };
}
describe("single-Forum setup and scoped YouTube cleanup", () => {
  it("creates a missing Forum only through explicit setup", async () => {
    const { runtime, clearSetup, store } = fixture();
    clearSetup();
    await runtime.setup("guild");
    expect(discord.provisionVideoForum).toHaveBeenCalledOnce();
    expect(store.setForum).toHaveBeenCalledWith("guild", "forum", 1);
  });
  it("rejects a missing selection instead of creating a Forum from add", async () => {
    const { runtime } = fixture();
    await expect(runtime.add("guild", "@creator", 10, "missing")).rejects.toThrow("Choose a Forum");
    expect(discord.provisionVideoForum).not.toHaveBeenCalled();
  });
  it("rejects a second Forum while creators are tracked", async () => {
    const { runtime, forum, store } = fixture();
    discord.getVideoForum.mockResolvedValue({ ...forum, id: "different-forum" });
    await expect(runtime.add("guild", "@creator", 10, "different-forum")).rejects.toThrow(
      "Only one YouTube Forum",
    );
    expect(store.setForum).not.toHaveBeenCalled();
  });
  it("uses an explicitly selected existing Forum without rewriting its overwrites", async () => {
    const { runtime, clearSetup, store } = fixture();
    clearSetup();
    store.subscriptions.mockResolvedValue([]);
    await runtime.add("guild", "@creator", 10, "forum");
    expect(store.setForum).toHaveBeenCalledWith("guild", "forum", 1, false);
    expect(discord.checkVideoPermissions).toHaveBeenCalled();
    expect(discord.auditVideoPermissions).not.toHaveBeenCalled();
    expect(discord.provisionVideoForum).not.toHaveBeenCalled();
  });
  it("reuses configured setup rather than creating another channel", async () => {
    const { runtime } = fixture();
    await runtime.setup("guild");
    expect(discord.provisionVideoForum).not.toHaveBeenCalled();
  });
  it("deletes only a selected creator's videos and retains tracking for future videos", async () => {
    const { runtime, store, forum } = fixture();
    await runtime.clean("guild", "forum", 1, "videos", "tag-a");
    expect(discord.deleteVideoPosts).toHaveBeenCalledWith(forum, "tag-a", new Set(["thread"]));
    expect(store.publicationThreads).toHaveBeenCalledWith("guild", "creator-a");
    expect(store.excludeVideos).toHaveBeenCalledWith("guild", "creator-a");
    expect(store.removeCreator).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(forum.delete).not.toHaveBeenCalled();
    expect(forum.setAvailableTags).not.toHaveBeenCalled();
    expect(store.setForum).toHaveBeenCalledWith("guild", "forum", 1, true);
  });
  it("deletes all videos without removing the Forum or subscriptions", async () => {
    const { runtime, store, forum } = fixture();
    await runtime.clean("guild", "forum", 1, "videos");
    expect(store.excludeVideos).toHaveBeenCalledWith("guild", undefined);
    expect(forum.delete).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });
  it("full creator cleanup removes only that subscription and its owned tag", async () => {
    const { runtime, store, forum } = fixture();
    await runtime.clean("guild", "forum", 1, "resources", "tag-a");
    expect(store.removeCreator).toHaveBeenCalledWith("guild", "creator-a");
    expect(forum.setAvailableTags).toHaveBeenCalledWith([
      { id: "tag-b", name: "Creator B" },
      { id: "unrelated", name: "Other" },
    ]);
    expect(forum.delete).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });
  it("full cleanup deletes a feature-owned Forum and its guild tracking", async () => {
    const { runtime, store, forum } = fixture();
    await runtime.clean("guild", "forum", 1, "resources");
    expect(forum.delete).toHaveBeenCalled();
    expect(store.remove).toHaveBeenCalledWith("guild");
  });
  it("full cleanup of a user-selected Forum preserves the channel and unrelated tags", async () => {
    const { runtime, store, forum } = fixture(false);
    await runtime.clean("guild", "forum", 1, "resources");
    expect(forum.delete).not.toHaveBeenCalled();
    expect(discord.deleteVideoPosts).toHaveBeenCalled();
    expect(forum.setAvailableTags).toHaveBeenCalledWith([{ id: "unrelated", name: "Other" }]);
    expect(store.remove).toHaveBeenCalledWith("guild");
  });
  it("rejects stale Forum generations and arbitrary tags before deleting anything", async () => {
    const { runtime, store } = fixture();
    await expect(runtime.clean("guild", "forum", 2, "resources")).rejects.toThrow("changed");
    await expect(runtime.clean("guild", "forum", 1, "videos", "invalid")).rejects.toThrow(
      "tag changed",
    );
    expect(store.cleaning).not.toHaveBeenCalled();
    expect(discord.deleteVideoPosts).not.toHaveBeenCalled();
  });
  it("keeps partial failures in cleaning state, blocking publication until retried", async () => {
    const { runtime, store } = fixture();
    discord.deleteVideoPosts.mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(runtime.clean("guild", "forum", 1, "videos", "tag-a")).rejects.toThrow(
      "Discord unavailable",
    );
    await expect(runtime.sync("guild")).rejects.toThrow("not active");
    expect(store.excludeVideos).not.toHaveBeenCalled();
    await runtime.clean("guild", "forum", 1, "videos", "tag-a");
    expect(store.excludeVideos).toHaveBeenCalledWith("guild", "creator-a");
  });
  it("offers saved creator tag IDs for recovery even after a tag is removed", async () => {
    const { runtime, forum } = fixture();
    forum.availableTags = [];
    expect(await runtime.creatorTags("guild")).toEqual([
      { id: "tag-a", name: "creator-a" },
      { id: "tag-b", name: "creator-b" },
    ]);
  });
});
