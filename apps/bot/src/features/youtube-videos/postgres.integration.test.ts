import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@discords/db";
import { eq } from "@discords/db/orm";
import { youtubeChannels, youtubeVideos } from "@discords/db/schema";
import { createVideosRepository } from "./videos-repository.ts";

const url = process.env.TEST_DATABASE_URL;
const database = url ? createDatabase(url) : undefined;
const store = url ? createVideosRepository(url) : undefined;
const second = url ? createVideosRepository(url) : undefined;
afterAll(async () => {
  await Promise.all([database?.pool.end(), store?.close(), second?.close()]);
});
const channelId = `UC${"z".repeat(22)}`;
const id = (index: number) => `Z${index.toString().padStart(10, "0")}`;
const makeVideo = (
  index: number,
  publishedAt = new Date(`2026-09-${index.toString().padStart(2, "0")}T00:00:00Z`),
) => ({
  channelId,
  videoId: id(index),
  sourceEntryId: `yt:video:${id(index)}`,
  title: `Guide ${index}`,
  description: "Guide description",
  publishedAt,
  url: `https://www.youtube.com/watch?v=${id(index)}`,
});

describe.skipIf(!url)("YouTube Discord persistence", () => {
  it("persists per-guild creator filters, filters repair/live work and changes prospectively without reposting", async () => {
    const channel = `UC${"f".repeat(22)}`;
    await database!.db
      .insert(youtubeChannels)
      .values({
        channelId: channel,
        displayName: "Filtered creator",
        canonicalUrl: `https://www.youtube.com/channel/${channel}`,
      });
    const source = (index: number, isShort: boolean | null) => ({
      ...makeVideo(1),
      channelId: channel,
      videoId: `F${String(index).padStart(10, "0")}`,
      sourceEntryId: `yt:video:F${String(index).padStart(10, "0")}`,
      url: `https://www.youtube.com/watch?v=F${String(index).padStart(10, "0")}`,
      isShort,
    });
    await database!.db
      .insert(youtubeVideos)
      .values([source(1, false), source(2, true), source(3, null)]);
    await Promise.all(
      ["yt-filter-video", "yt-filter-short"].map(async (guild) => {
        await store!.createSettings(guild);
        await store!.setForum(guild, `${guild}-f`, 1);
      }),
    );
    await store!.subscribe(
      "yt-filter-video",
      channel,
      "tag",
      true,
      1,
      [source(1, false).videoId],
      1,
      "videos",
    );
    await store!.subscribe(
      "yt-filter-short",
      channel,
      "tag",
      true,
      1,
      [source(2, true).videoId],
      1,
      "shorts",
    );
    expect((await second!.subscriptions("yt-filter-video"))[0]!.subscription.contentMode).toBe(
      "videos",
    );
    expect((await second!.subscriptions("yt-filter-short"))[0]!.subscription.contentMode).toBe(
      "shorts",
    );
    // Forum repair must choose matching items, not the newest item irrespective of type.
    await store!.resetForum("yt-filter-video");
    await store!.setForum("yt-filter-video", "repaired-forum", 2);
    await store!.repairSubscription(
      "yt-filter-video",
      (await store!.subscriptions("yt-filter-video"))[0]!.subscription,
      "tag",
      true,
      2,
    );
    expect((await store!.pending("yt-filter-video")).map(({ video }) => video.videoId)).toEqual([
      source(1, false).videoId,
    ]);
    await database!.db
      .insert(youtubeVideos)
      .values([source(4, false), source(5, true), source(6, null)]);
    await store!.enqueue("yt-filter-video", 2);
    await store!.enqueue("yt-filter-short", 1);
    expect((await second!.pending("yt-filter-video")).map(({ video }) => video.videoId)).toEqual([
      source(1, false).videoId,
      source(4, false).videoId,
    ]);
    expect((await second!.pending("yt-filter-short")).map(({ video }) => video.videoId)).toEqual([
      source(2, true).videoId,
      source(5, true).videoId,
    ]);
    const posted = (await store!.pending("yt-filter-video"))[0]!;
    await store!.published(posted.intent, "filtered-thread");
    await database!.db.insert(youtubeVideos).values(source(7, true));
    await store!.setContentMode("yt-filter-video", channel, "shorts");
    await store!.completeInitial("yt-filter-video");
    await store!.enqueue("yt-filter-video", 2);
    expect(await second!.pending("yt-filter-video")).toEqual([]);
    expect(await second!.publicationThreads("yt-filter-video")).toContain(
      "filtered-thread",
    );
    expect(
      (await second!.subscriptions("yt-filter-video"))[0]!.subscription.initialImportCompletedAt,
    ).toBeInstanceOf(Date);
    await database!.db.insert(youtubeVideos).values([source(8, false), source(9, true)]);
    await store!.enqueue("yt-filter-video", 2);
    expect((await second!.pending("yt-filter-video")).map(({ video }) => video.videoId)).toEqual([
      source(9, true).videoId,
    ]);
    await store!.setContentMode("yt-filter-video", channel, "all");
    await store!.enqueue("yt-filter-video", 2);
    expect((await second!.pending("yt-filter-video")).map(({ video }) => video.videoId)).toEqual([
      source(9, true).videoId,
    ]);
    // The other guild's creator preference and queue are unaffected.
    expect((await second!.subscriptions("yt-filter-short"))[0]!.subscription.contentMode).toBe(
      "shorts",
    );
    // Narrowing also cancels interrupted initial work without losing its cleanup checkpoint.
    const interrupted = (await store!.pending("yt-filter-short"))[0]!;
    await store!.begin(interrupted.intent);
    await store!.checkpoint(interrupted.intent, "filter-partial");
    await store!.failed(interrupted.intent);
    await store!.setContentMode("yt-filter-short", channel, "videos");
    await store!.completeInitial("yt-filter-short");
    expect(await second!.pending("yt-filter-short")).toEqual([]);
    expect(await second!.publicationThreads("yt-filter-short")).toContain("filter-partial");
    expect(
      (await second!.subscriptions("yt-filter-short"))[0]!.subscription.initialImportCompletedAt,
    ).toBeInstanceOf(Date);
    await Promise.all([store!.remove("yt-filter-video"), store!.remove("yt-filter-short")]);
  });
  it("snapshots all stored sources, imports ten, excludes the initial remainder and survives restart", async () => {
    await database!.db.insert(youtubeChannels).values({
      channelId,
      displayName: "Guide Creator",
      canonicalUrl: `https://www.youtube.com/channel/${channelId}`,
    });
    await database!.db
      .insert(youtubeVideos)
      .values(Array.from({ length: 15 }, (_, index) => makeVideo(index + 1)));
    await store!.createSettings("yt-main");
    await store!.setForum("yt-main", "yt-forum", 1);
    await store!.subscribe(
      "yt-main",
      channelId,
      "yt-tag",
      true,
      10,
      Array.from({ length: 10 }, (_, index) => id(index + 6)),
      1,
    );
    expect(await second!.counts("yt-main")).toContain("Other videos: 5");
    const pending = await second!.pending("yt-main");
    expect(pending).toHaveLength(10);
    expect(pending[0]!.video.videoId).toBe(id(6));
    await store!.begin(pending[0]!.intent);
    await store!.checkpoint(pending[0]!.intent, "yt-thread-6");
    await store!.failed(pending[0]!.intent);
    expect((await second!.pending("yt-main"))[0]!.intent).toMatchObject({
      state: "needs_reconciliation",
      threadId: "yt-thread-6",
      attempts: 1,
    });
    await store!.published(pending[0]!.intent, "yt-thread-6");
    await store!.published(pending[0]!.intent, "yt-thread-6");
    expect(await store!.counts("yt-main")).toContain("Published: 1");
    await store!.enqueue("yt-main", 1);
    expect(await store!.pending("yt-main")).toHaveLength(9);
  });
  it("does not rebaseline new sources during an interrupted initial import", async () => {
    await database!.db.insert(youtubeVideos).values(makeVideo(16, new Date("2026-01-01")));
    const subscription = (await store!.subscriptions("yt-main"))[0]!.subscription;
    await store!.repairSubscription("yt-main", subscription, "yt-tag", true, 1);
    await store!.enqueue("yt-main", 1);
    const pending = await store!.pending("yt-main");
    expect(pending.find((row) => row.video.videoId === id(16))!.intent).toMatchObject({
      mode: "live",
      state: "pending",
    });
    await pending
      .filter((row) => row.intent.mode === "initial")
      .reduce(async (previous, row) => {
        await previous;
        await store!.published(row.intent, `yt-thread-${Number(row.video.videoId.slice(1))}`);
      }, Promise.resolve());
    await store!.completeInitial("yt-main");
    expect(
      (await second!.subscriptions("yt-main"))[0]!.subscription.initialImportCompletedAt,
    ).toBeInstanceOf(Date);
    expect(await second!.pending("yt-main")).toHaveLength(1);
    expect(await second!.counts("yt-main")).toContain("Other videos: 5");
  });
  it("serializes setup/publication/cleanup across processes and releases locks on failure", async () => {
    await store!.withGuild("yt-main", async () => {
      await expect(second!.withGuild("yt-main", async () => {})).rejects.toThrow(
        "already being updated",
      );
    });
    await expect(
      store!.withGuild("yt-main", async () => {
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");
    await expect(second!.withGuild("yt-main", async () => "released")).resolves.toBe("released");
  });
  it("excludes scoped deleted videos without reposting them and keeps future sources eligible", async () => {
    const a = `UC${"x".repeat(22)}`;
    const b = `UC${"w".repeat(22)}`;
    await database!.db.insert(youtubeChannels).values([
      { channelId: a, displayName: "A", canonicalUrl: `https://www.youtube.com/channel/${a}` },
      { channelId: b, displayName: "B", canonicalUrl: `https://www.youtube.com/channel/${b}` },
    ]);
    const source = (channelId: string, videoId: string) => ({
      ...makeVideo(1),
      channelId,
      videoId,
      sourceEntryId: `yt:video:${videoId}`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
    await database!.db
      .insert(youtubeVideos)
      .values([source(a, "X0000000001"), source(b, "W0000000001")]);
    await store!.createSettings("yt-clean");
    await store!.setForum("yt-clean", "yt-clean-forum", 1, false);
    expect((await store!.get("yt-clean"))!.ownsForum).toBe(false);
    await store!.subscribe("yt-clean", a, "tag-a", true, 1, ["X0000000001"], 1);
    await store!.subscribe("yt-clean", b, "tag-b", true, 1, ["W0000000001"], 1);
    const first = (await store!.pending("yt-clean")).find((row) => row.video.channelId === a)!;
    await store!.published(first.intent, "yt-clean-thread");
    expect(await store!.publicationThreads("yt-clean", a)).toEqual(["yt-clean-thread"]);
    // This source was ingested but never enqueued before cleanup.
    await database!.db.insert(youtubeVideos).values(source(a, "X0000000002"));
    await store!.excludeVideos("yt-clean", a);
    await store!.enqueue("yt-clean", 1);
    expect((await store!.pending("yt-clean")).map((row) => row.video.videoId)).toEqual([
      "W0000000001",
    ]);
    expect(await store!.publicationThreads("yt-clean", a)).toEqual([]);
    expect(await store!.subscriptions("yt-clean")).toHaveLength(2);
    await database!.db.insert(youtubeVideos).values(source(a, "X0000000003"));
    await store!.enqueue("yt-clean", 1);
    expect((await store!.pending("yt-clean")).map((row) => row.video.videoId)).toContain(
      "X0000000003",
    );
    await store!.removeCreator("yt-clean", a);
    expect((await store!.subscriptions("yt-clean")).map((row) => row.creator.channelId)).toEqual([
      b,
    ]);
    expect((await store!.pending("yt-clean")).map((row) => row.video.videoId)).toEqual([
      "W0000000001",
    ]);
    await store!.remove("yt-clean");
  });
  it("persists the creator list across connections with unpinned defaults", async () => {
    expect(await second!.get("yt-main")).toMatchObject({
      creatorListThreadId: null,
      creatorListPinned: false,
    });
    await store!.setCreatorList("yt-main", "yt-list-thread", true);
    expect(await second!.get("yt-main")).toMatchObject({
      creatorListThreadId: "yt-list-thread",
      creatorListPinned: true,
    });
  });
  it("recreates missing Forums with fresh mappings and cleans only the target guild", async () => {
    await store!.createSettings("yt-other");
    await store!.setForum("yt-other", "yt-other-forum", 1);
    await store!.subscribe("yt-other", channelId, "yt-other-tag", true, 0, [], 1);
    await store!.completeInitial("yt-other");
    await store!.resetForum("yt-main");
    expect(await store!.get("yt-main")).toMatchObject({
      lifecycle: "disabled",
      forumChannelId: null,
      forumGeneration: 2,
      creatorListThreadId: null,
      creatorListPinned: false,
    });
    expect(await store!.pending("yt-main")).toEqual([]);
    await store!.setForum("yt-main", "yt-new-forum", 2);
    const subscription = (await store!.subscriptions("yt-main"))[0]!.subscription;
    await store!.repairSubscription("yt-main", subscription, "yt-new-tag", true, 2);
    expect(await store!.pending("yt-main")).toHaveLength(10);
    await store!.cleaning("yt-main");
    expect(await store!.guildIds()).not.toContain("yt-main");
    await store!.remove("yt-main");
    expect(await second!.get("yt-main")).toBeNull();
    expect(await second!.subscriptions("yt-main")).toEqual([]);
    expect(await second!.get("yt-other")).toMatchObject({ lifecycle: "active" });
    expect(
      await database!.db.select().from(youtubeVideos).where(eq(youtubeVideos.channelId, channelId)),
    ).toHaveLength(16);
  });
});
