import { describe, expect, it, vi } from "vitest";
import { ChannelType, Collection, type Client, type ForumChannel } from "discord.js";
import { deleteVideoPosts, publishVideo, renderVideo } from "./videos-discord.ts";
import type { ForumSettings, Intent, Video } from "./videos-repository.ts";
const video: Video = {
  videoId: "abcdefghijk",
  channelId: `UC${"a".repeat(22)}`,
  sourceEntryId: "yt:video:abcdefghijk",
  title: "Guide",
  description: "Guide description ".repeat(200),
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  publishedAt: new Date("2026-10-01"),
  sourceUpdatedAt: null,
  firstSeenAt: new Date(),
  lastSeenAt: new Date(),
};
const setup: ForumSettings = {
  guildId: "guild",
  forumChannelId: "forum",
  forumGeneration: 1,
  lifecycle: "active",
  ownsForum: true,
  lastPublishedAt: null,
};
const intent: Intent = {
  guildId: "guild",
  channelId: video.channelId,
  videoId: video.videoId,
  forumGeneration: 1,
  state: "pending",
  mode: "initial",
  threadId: null,
  starterMessageId: null,
  attempts: 0,
  lastError: null,
  updatedAt: new Date(),
};
type PublicationMessage =
  | ReturnType<typeof renderVideo>[number]
  | {
      content: string;
      allowedMentions: { parse: [] };
    };
function fixture() {
  const starter = {
    content: "",
    id: "thread",
    author: { id: "bot" },
    components: renderVideo(video)[0]!.components,
  };
  const messages = new Collection([["thread", starter]]);
  const thread = {
    id: "thread",
    parentId: "forum",
    name: video.title.slice(0, 100),
    archived: false,
    archiveTimestamp: null,
    appliedTags: ["tag"],
    delete: vi.fn(async () => {}),
    client: { user: { id: "bot" } },
    isThread: () => true,
    fetchStarterMessage: vi.fn(async () => starter as typeof starter | null),
    messages: { fetch: vi.fn(async () => messages) },
    send: vi.fn(async (message: PublicationMessage) => {
      messages.set(`part-${messages.size}`, {
        id: `part-${messages.size}`,
        author: { id: "bot" },
        components: "components" in message ? message.components : [],
        content: "content" in message ? message.content : "",
      });
    }),
  };
  const forum = {
    id: "forum",
    type: ChannelType.GuildForum,
    guildId: "guild",
    availableTags: [{ id: "tag" }],
    client: thread.client,
    threads: {
      create: vi.fn(async () => thread),
      fetchActive: vi.fn(async () => ({ threads: new Collection([["thread", thread]]) })),
      fetchArchived: vi.fn(async () => ({ threads: new Collection(), hasMore: false })),
    },
  };
  const guild = {
    channels: {
      fetch: vi.fn(async (id: string) =>
        id === "forum" ? forum : id === "thread" ? thread : null,
      ),
    },
  };
  const client = { guilds: { fetch: async () => guild } } as unknown as Client;
  return { client, thread, forum, messages };
}
describe("scoped video post deletion", () => {
  it("deletes bot-owned managed posts for the selected tag including archived posts", async () => {
    const { forum, thread } = fixture();
    const archived = { ...thread, id: "archived", delete: vi.fn() };
    forum.threads.fetchArchived.mockResolvedValueOnce({
      threads: new Collection([["archived", archived]]),
      hasMore: false,
    });
    expect(await deleteVideoPosts(forum as unknown as ForumChannel, "tag")).toBe(2);
    expect(thread.delete).toHaveBeenCalledOnce();
    expect(archived.delete).toHaveBeenCalledOnce();
  });
  it("preserves other creators and human-authored posts even when they copy a marker", async () => {
    const { forum, thread, messages } = fixture();
    thread.appliedTags = ["other-tag"];
    expect(await deleteVideoPosts(forum as unknown as ForumChannel, "tag")).toBe(0);
    thread.appliedTags = ["tag"];
    messages.get("thread")!.author.id = "human";
    expect(await deleteVideoPosts(forum as unknown as ForumChannel, "tag")).toBe(0);
    expect(thread.delete).not.toHaveBeenCalled();
  });
  it("preserves unrelated bot posts without the exact video source footer", async () => {
    const { forum, thread } = fixture();
    thread.fetchStarterMessage.mockResolvedValueOnce({
      id: "thread",
      content: "Unrelated",
      author: { id: "bot" },
      components: [],
    });
    expect(await deleteVideoPosts(forum as unknown as ForumChannel)).toBe(0);
    expect(thread.delete).not.toHaveBeenCalled();
  });
  it("uses saved thread IDs when a managed post's creator tag was removed", async () => {
    const { forum, thread } = fixture();
    thread.appliedTags = [];
    expect(
      await deleteVideoPosts(forum as unknown as ForumChannel, "tag", new Set(["thread"])),
    ).toBe(1);
    expect(thread.delete).toHaveBeenCalledOnce();
  });
  it("can delete a known managed thread whose starter was removed", async () => {
    const { forum, thread } = fixture();
    thread.fetchStarterMessage.mockResolvedValueOnce(null);
    expect(
      await deleteVideoPosts(forum as unknown as ForumChannel, "tag", new Set(["thread"])),
    ).toBe(1);
  });
});
describe("resumable video publication", () => {
  it("checkpoints immediately and resumes a crash between Discord creation and persistence without another post", async () => {
    const { client, forum, thread } = fixture();
    await expect(
      publishVideo(client, setup, intent, video, "tag", async () => {
        throw new Error("DB unavailable");
      }),
    ).rejects.toThrow("DB unavailable");
    expect(forum.threads.create).toHaveBeenCalledOnce();
    expect(forum.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: video.title }),
    );
    expect(thread.send).not.toHaveBeenCalled();
    const checkpoint = vi.fn(async () => {});
    expect(
      await publishVideo(
        client,
        setup,
        { ...intent, state: "needs_reconciliation" },
        video,
        "tag",
        checkpoint,
      ),
    ).toBe("thread");
    expect(forum.threads.create).toHaveBeenCalledOnce();
    expect(checkpoint).toHaveBeenCalledWith("thread");
    expect(thread.send).toHaveBeenCalledTimes(renderVideo(video).length);
    expect(thread.send.mock.calls.at(-1)![0]).toEqual({
      content: video.url,
      allowedMentions: { parse: [] },
    });
    const sends = thread.send.mock.calls.length;
    await publishVideo(
      client,
      setup,
      { ...intent, state: "needs_reconciliation", threadId: "thread" },
      video,
      "tag",
      checkpoint,
    );
    expect(thread.send).toHaveBeenCalledTimes(sends);
  });
  it.each([false, true])(
    "resumes a URL send failure without duplicating parts or previews (accepted=%s)",
    async (accepted) => {
      const { client, thread, messages } = fixture();
      const send = thread.send.getMockImplementation()!;
      thread.send.mockImplementation(async (message) => {
        if ("content" in message) {
          if (accepted) await send(message);
          throw new Error("Discord request failed");
        }
        await send(message);
      });
      await expect(
        publishVideo(client, setup, intent, video, "tag", async () => {}),
      ).rejects.toThrow("Discord request failed");
      thread.send.mockImplementation(send);
      await publishVideo(
        client,
        setup,
        { ...intent, threadId: "thread", state: "needs_reconciliation" },
        video,
        "tag",
        async () => {},
      );
      expect(messages.size).toBe(renderVideo(video).length + 1);
      expect(
        [...messages.values()].filter((message) => message.content === video.url),
      ).toHaveLength(1);
    },
  );
  it("ignores other authors' video links when reconciling the bot preview", async () => {
    const { client, thread, messages } = fixture();
    messages.set("human-link", {
      id: "human-link",
      author: { id: "human" },
      content: video.url,
      components: [],
    });
    await publishVideo(client, setup, intent, video, "tag", async () => {});
    expect(thread.send.mock.calls.at(-1)![0]).toMatchObject({ content: video.url });
  });
  it("limits post titles to 100 characters without appending the video ID", async () => {
    const { client, forum } = fixture();
    await publishVideo(
      client,
      setup,
      intent,
      { ...video, title: "a".repeat(120) },
      "tag",
      async () => {},
    );
    expect(forum.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "a".repeat(100) }),
    );
  });
  it.each([`Guide [${video.videoId}]`, "An older or manually renamed title"])(
    "reconciles an existing post by its source marker regardless of title: %s",
    async (name) => {
      const { client, forum, thread } = fixture();
      thread.name = name;
      await publishVideo(
        client,
        setup,
        { ...intent, state: "needs_reconciliation" },
        video,
        "tag",
        async () => {},
      );
      expect(forum.threads.create).not.toHaveBeenCalled();
    },
  );
  it("does not blindly repost a known missing thread", async () => {
    const { client, forum } = fixture();
    await expect(
      publishVideo(client, setup, { ...intent, threadId: "deleted" }, video, "tag", async () => {}),
    ).rejects.toThrow("manual repair");
    expect(forum.threads.create).not.toHaveBeenCalled();
  });
  it("rejects ambiguous matching posts rather than creating another", async () => {
    const { client, forum, thread } = fixture();
    forum.threads.fetchActive.mockResolvedValueOnce({
      threads: new Collection([
        ["thread", thread],
        ["duplicate", { ...thread, id: "duplicate" }],
      ]),
    });
    await expect(
      publishVideo(
        client,
        setup,
        { ...intent, state: "in_progress" },
        video,
        "tag",
        async () => {},
      ),
    ).rejects.toThrow("Multiple matching");
    expect(forum.threads.create).not.toHaveBeenCalled();
  });
});
