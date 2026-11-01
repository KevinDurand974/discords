import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { buildVideosRuntime } from "./videos-runtime.ts";
import type { ForumSettings, VideosRepository } from "./videos-repository.ts";
import type { createVideosApi, ResolvedCreator } from "./videos-api.ts";

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
const lists = vi.hoisted(() => ({ updateCreatorList: vi.fn(), deleteCreatorList: vi.fn() }));
vi.mock("./creator-list.ts", () => lists);
beforeEach(() => {
  vi.resetAllMocks();
});
const creator = (channelId: string, tagId: string) => ({
  creator: { channelId, displayName: channelId },
  subscription: {
    channelId,
    tagId,
    ownsTag: true,
    initialImportCompletedAt: new Date(),
    contentMode: "all" as const,
  },
});
function fixture(ownsForum = true) {
  let setup: ForumSettings | null = {
    guildId: "guild",
    forumChannelId: "forum",
    forumGeneration: 1,
    ownsForum,
    lifecycle: "active",
    lastPublishedAt: null,
    creatorListThreadId: null,
    creatorListPinned: false,
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
    get: vi.fn(async (_guildId?: string) => setup),
    withGuild: vi.fn(async (_id: string, work: () => Promise<unknown>) => work()),
    createSettings: vi.fn(async () => {
      setup ??= {
        guildId: "guild",
        forumChannelId: null,
        forumGeneration: 1,
        lifecycle: "disabled",
        ownsForum: true,
        lastPublishedAt: null,
        creatorListThreadId: null,
        creatorListPinned: false,
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
    setContentMode: vi.fn(),
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
    resolve: vi.fn(async (): Promise<ResolvedCreator> => ({
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
    enableList: () => {
      setup!.creatorListThreadId = "list-thread";
      setup!.creatorListPinned = true;
    },
    store,
    forum,
    api,
    clearSetup: () => {
      setup = null;
    },
  };
}
describe("single-Forum setup and scoped YouTube cleanup", () => {
  it.each(["all", "videos", "shorts"] as const)(
    "filters initial backfill before taking the newest count: %s",
    async (mode) => {
      const { runtime, store, api } = fixture();
      store.subscriptions.mockResolvedValue([]);
      api.resolve.mockResolvedValue({
        channel: { channelId: "creator-a", displayName: "Creator A" },
        videos: [
          { videoId: "regular0001", publishedAt: "2026-10-01T00:00:00Z", isShort: false },
          { videoId: "short000001", publishedAt: "2026-10-03T00:00:00Z", isShort: true },
          { videoId: "unknown0001", publishedAt: "2026-10-04T00:00:00Z", isShort: null },
        ],
      });
      await runtime.add("guild", "@creator", 1, "forum", mode);
      const expected =
        mode === "all" ? "unknown0001" : mode === "videos" ? "regular0001" : "short000001";
      expect(store.subscribe).toHaveBeenCalledWith(
        "guild",
        "creator-a",
        "tag-a",
        true,
        1,
        [expected],
        1,
        mode,
      );
    },
  );
  it("changes only the selected creator under the guild lock and refreshes its list", async () => {
    const { runtime, store, enableList } = fixture();
    enableList();
    await expect(runtime.content("guild", "tag-b", "shorts")).resolves.toEqual({
      listFailed: false,
    });
    expect(store.setContentMode).toHaveBeenCalledExactlyOnceWith("guild", "creator-b", "shorts");
    expect(store.withGuild).toHaveBeenCalledWith("guild", expect.any(Function));
    expect(lists.updateCreatorList).toHaveBeenCalledOnce();
    expect(discord.publishVideo).not.toHaveBeenCalled();
  });
  it("does not reset the baseline when selecting the same content preference", async () => {
    const { runtime, store } = fixture();
    await runtime.content("guild", "tag-a", "all");
    expect(store.setContentMode).not.toHaveBeenCalled();
  });
  it("requires content edits to use the separate subcommand instead of add", async () => {
    const { runtime, store } = fixture();
    await expect(runtime.add("guild", "@creator", 10, "forum", "shorts")).rejects.toThrow(
      "/youtube content",
    );
    expect(store.setContentMode).not.toHaveBeenCalled();
  });
  it("rejects forged creator tags and paused setups before editing content", async () => {
    const { runtime, store } = fixture();
    await expect(runtime.content("guild", "forged", "shorts")).rejects.toThrow(
      "current creator tag",
    );
    await store.cleaning();
    await expect(runtime.content("guild", "tag-a", "shorts")).rejects.toThrow(
      "finish /youtube clean",
    );
    expect(store.setContentMode).not.toHaveBeenCalled();
  });
  it("reports creator-list failure without rolling back a saved preference", async () => {
    const { runtime, store, enableList } = fixture();
    enableList();
    lists.updateCreatorList.mockRejectedValue(new Error("Discord offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(runtime.content("guild", "tag-a", "videos")).resolves.toEqual({
        listFailed: true,
      });
      expect(store.setContentMode).toHaveBeenCalledWith("guild", "creator-a", "videos");
    } finally {
      log.mockRestore();
    }
  });
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
      "A YouTube Forum is already configured",
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
    await expect(runtime.sync("guild")).rejects.toThrow(
      "YouTube publishing is paused. Finish /youtube clean",
    );
    expect(store.excludeVideos).not.toHaveBeenCalled();
    await runtime.clean("guild", "forum", 1, "videos", "tag-a");
    expect(store.excludeVideos).toHaveBeenCalledWith("guild", "creator-a");
  });
  it("creates a list only on request, with pinning disabled by default", async () => {
    const { runtime, store, forum } = fixture();
    await runtime.list("guild");
    expect(lists.updateCreatorList).toHaveBeenCalledWith(
      forum,
      await store.get("guild"),
      store,
      false,
    );
    await runtime.list("guild", true);
    expect(lists.updateCreatorList).toHaveBeenLastCalledWith(
      forum,
      await store.get("guild"),
      store,
      true,
    );
    expect(store.withGuild).toHaveBeenCalled();
  });
  it("does not create a creator list implicitly when adding", async () => {
    const { runtime } = fixture();
    await runtime.add("guild", "@creator", 0, "forum");
    expect(lists.updateCreatorList).not.toHaveBeenCalled();
  });
  it("refreshes an existing list after adding a creator and on sync", async () => {
    const { runtime, store, forum, enableList } = fixture();
    enableList();
    store.subscriptions.mockResolvedValue([]);
    await runtime.add("guild", "@creator", 0, "forum");
    expect(store.subscribe).toHaveBeenCalled();
    expect(lists.updateCreatorList).toHaveBeenCalledWith(forum, await store.get("guild"), store);
    expect(store.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      lists.updateCreatorList.mock.invocationCallOrder[0]!,
    );
    await runtime.sync("guild");
    expect(lists.updateCreatorList).toHaveBeenCalledTimes(2);
  });
  it("reports list failures without blocking video publication", async () => {
    const { runtime, store, enableList } = fixture();
    enableList();
    lists.updateCreatorList.mockRejectedValueOnce(new Error("pin denied"));
    const result = await runtime.sync("guild");
    expect(store.completeInitial).toHaveBeenCalledWith("guild");
    expect(result).toMatchObject({ listFailed: true });
  });
  it("refreshes the list after removing a creator but not after videos-only cleanup", async () => {
    const { runtime, store, enableList } = fixture();
    enableList();
    await runtime.clean("guild", "forum", 1, "videos", "tag-a");
    expect(lists.updateCreatorList).not.toHaveBeenCalled();
    await runtime.clean("guild", "forum", 1, "resources", "tag-a");
    expect(lists.updateCreatorList).toHaveBeenCalledOnce();
    expect(store.removeCreator.mock.invocationCallOrder[0]).toBeLessThan(
      lists.updateCreatorList.mock.invocationCallOrder[0]!,
    );
  });
  it("removes the list during full cleanup of a user-owned Forum", async () => {
    const { runtime, forum, store, enableList } = fixture(false);
    enableList();
    await runtime.clean("guild", "forum", 1, "resources");
    expect(lists.deleteCreatorList).toHaveBeenCalledWith(
      forum,
      expect.objectContaining({ creatorListThreadId: "list-thread" }),
    );
    expect(store.remove).toHaveBeenCalledWith("guild");
  });
  it("reports a list update failure without rolling back a removed creator", async () => {
    const { runtime, store, enableList } = fixture();
    enableList();
    lists.updateCreatorList.mockRejectedValueOnce(new Error("Discord offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(runtime.clean("guild", "forum", 1, "resources", "tag-a")).rejects.toThrow(
        "run /youtube list",
      );
      expect(store.removeCreator).toHaveBeenCalledWith("guild", "creator-a");
      expect((await store.get())?.lifecycle).toBe("active");
    } finally {
      log.mockRestore();
    }
  });
  it("rejects list publication when setup is missing or cleanup is in progress", async () => {
    const { runtime, clearSetup, store } = fixture();
    await store.cleaning();
    await expect(runtime.list("guild")).rejects.toThrow("finish /youtube clean");
    clearSetup();
    await expect(runtime.list("guild")).rejects.toThrow("/youtube setup");
    expect(lists.updateCreatorList).not.toHaveBeenCalled();
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
