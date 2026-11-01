import { describe, expect, it, vi } from "vitest";
import { ChannelFlagsBitField, type ForumChannel } from "discord.js";
import { deleteCreatorList, renderCreatorList, updateCreatorList } from "./creator-list.ts";
import type { ForumSettings, VideosRepository } from "./videos-repository.ts";

type Tracked = Awaited<ReturnType<VideosRepository["subscriptions"]>>;
const tracked = [
  {
    creator: { channelId: `UC${"b".repeat(22)}`, displayName: "Zed" },
    subscription: { enabled: true, contentMode: "shorts" },
  },
  {
    creator: { channelId: `UC${"a".repeat(22)}`, displayName: "**Alice** {user}" },
    subscription: { enabled: true, contentMode: "videos" },
  },
  {
    creator: { channelId: `UC${"c".repeat(22)}`, displayName: "Disabled" },
    subscription: { enabled: false },
  },
] as Tracked;
function fixture(existing = false) {
  const setup: ForumSettings = {
    guildId: "guild",
    forumChannelId: "forum",
    forumGeneration: 1,
    lifecycle: "active",
    ownsForum: true,
    lastPublishedAt: null,
    creatorListThreadId: existing ? "list" : null,
    creatorListPinned: false,
  };
  const starter = { author: { id: "bot" }, edit: vi.fn() };
  const thread = {
    id: "list",
    parentId: "forum",
    ownerId: "bot",
    flags: new ChannelFlagsBitField(),
    archived: true,
    isThread: () => true,
    fetchStarterMessage: vi.fn(async () => starter),
    setArchived: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn(),
    delete: vi.fn(),
  };
  const fetch = vi.fn(async () => thread);
  const forum = {
    id: "forum",
    client: { user: { id: "bot" } },
    guild: { channels: { fetch } },
    flags: new ChannelFlagsBitField(),
    availableTags: [{ id: "tag" }],
    threads: { create: vi.fn(async () => thread) },
  };
  const store = { subscriptions: vi.fn(async () => tracked), setCreatorList: vi.fn() };
  const update = (pinned?: boolean) =>
    updateCreatorList(
      forum as unknown as ForumChannel,
      setup,
      store as unknown as VideosRepository,
      pinned,
    );
  return { setup, starter, thread, fetch, forum, store, update };
}

describe("YouTube creator list Forum post", () => {
  it("renders only enabled creators, sorted, with escaped names and YouTube links", () => {
    const payload = renderCreatorList(tracked);
    const json = JSON.stringify(payload.components[0]!.toJSON());
    expect(json).toContain("https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa");
    expect(json).not.toContain("Disabled");
    expect(json).toContain("Videos only");
    expect(json).toContain("Shorts only");
    expect(json.indexOf("Alice")).toBeLessThan(json.indexOf("Zed"));
    expect(json).toContain(JSON.stringify("\\*\\*Alice\\*\\* {user}").slice(1, -1));
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload.flags).toBe(32768);
  });
  it("shows an explicit empty state", () => {
    expect(JSON.stringify(renderCreatorList([]).components)).toContain(
      "No creators are currently followed.",
    );
  });
  it("creates and persists a post, unpinned by default", async () => {
    const f = fixture();
    await f.update();
    expect(f.forum.threads.create).toHaveBeenCalledOnce();
    expect(f.store.setCreatorList).toHaveBeenCalledWith("guild", "list", false);
    expect(f.thread.unpin).not.toHaveBeenCalled();
    expect(f.thread.pin).not.toHaveBeenCalled();
  });
  it("updates the existing starter and preserves the stored pin preference", async () => {
    const f = fixture(true);
    f.setup.creatorListPinned = true;
    await f.update();
    expect(f.fetch).toHaveBeenCalledWith("list", { force: true });
    expect(f.forum.threads.create).not.toHaveBeenCalled();
    expect(f.thread.setArchived).toHaveBeenCalledWith(false);
    expect(f.starter.edit).toHaveBeenCalledWith(renderCreatorList(tracked));
    expect(f.thread.pin).toHaveBeenCalledOnce();
    expect(f.store.setCreatorList).toHaveBeenCalledWith("guild", "list", true);
  });
  it("allows an explicit request to unpin an existing post", async () => {
    const f = fixture(true);
    f.setup.creatorListPinned = true;
    f.thread.flags.add(ChannelFlagsBitField.Flags.Pinned);
    await f.update(false);
    expect(f.thread.unpin).toHaveBeenCalledOnce();
    expect(f.store.setCreatorList).toHaveBeenCalledWith("guild", "list", false);
  });
  it.each([10003, 10008])("recreates a deleted list on Discord error %s", async (code) => {
    const f = fixture(true);
    f.fetch.mockRejectedValueOnce({ code });
    await f.update();
    expect(f.forum.threads.create).toHaveBeenCalledOnce();
  });
  it("does not create duplicates on permission or network errors", async () => {
    const f = fixture(true);
    f.fetch.mockRejectedValueOnce({ code: 50013 });
    await expect(f.update()).rejects.toEqual({ code: 50013 });
    expect(f.forum.threads.create).not.toHaveBeenCalled();
  });
  it("refuses to edit a post outside the Forum or authored by someone else", async () => {
    const f = fixture(true);
    f.thread.parentId = "other";
    await expect(f.update()).rejects.toThrow("outside");
    f.thread.parentId = "forum";
    f.starter.author.id = "someone-else";
    await expect(f.update()).rejects.toThrow("not owned");
    expect(f.starter.edit).not.toHaveBeenCalled();
    expect(f.forum.threads.create).not.toHaveBeenCalled();
  });
  it("cleans up a new post if saving its ID fails", async () => {
    const f = fixture();
    f.store.setCreatorList.mockRejectedValueOnce(new Error("database offline"));
    await expect(f.update()).rejects.toThrow("database offline");
    expect(f.thread.delete).toHaveBeenCalledOnce();
    expect(f.thread.pin).not.toHaveBeenCalled();
  });
  it("saves the thread ID before pinning so a failed pin can be retried", async () => {
    const f = fixture();
    f.thread.pin.mockRejectedValueOnce(new Error("pin denied"));
    await expect(f.update(true)).rejects.toThrow("pin denied");
    expect(f.store.setCreatorList.mock.invocationCallOrder[0]).toBeLessThan(
      f.thread.pin.mock.invocationCallOrder[0]!,
    );
    expect(f.thread.delete).not.toHaveBeenCalled();
  });
  it("uses an existing tag in Forums that require tags", async () => {
    const f = fixture();
    f.forum.flags.add(ChannelFlagsBitField.Flags.RequireTag);
    await f.update();
    expect(f.forum.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({ appliedTags: ["tag"] }),
    );
  });
  it("does not PATCH a post whose pin state already matches", async () => {
    const f = fixture(true);
    f.thread.flags.add(ChannelFlagsBitField.Flags.Pinned);
    await f.update(true);
    expect(f.thread.pin).not.toHaveBeenCalled();
    expect(f.thread.unpin).not.toHaveBeenCalled();
  });
  it("retains a thread with a deleted starter for full cleanup, without orphaning it", async () => {
    const f = fixture(true);
    f.thread.fetchStarterMessage.mockRejectedValue({ code: 10008 });
    await expect(f.update()).rejects.toThrow("first message is missing");
    expect(f.forum.threads.create).not.toHaveBeenCalled();
    expect(f.store.setCreatorList).not.toHaveBeenCalled();
    await deleteCreatorList(f.forum as unknown as ForumChannel, f.setup);
    expect(f.thread.delete).toHaveBeenCalledOnce();
  });
  it("deletes only the verified list on full cleanup", async () => {
    const f = fixture(true);
    await deleteCreatorList(f.forum as unknown as ForumChannel, f.setup);
    expect(f.thread.delete).toHaveBeenCalledOnce();
  });
});
