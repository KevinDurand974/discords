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
  it("snapshots all stored sources, imports ten, excludes the initial remainder and survives restart", async () => {
    await database!.db
      .insert(youtubeChannels)
      .values({
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
    expect(await second!.counts("yt-main")).toContain("excluded: 5");
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
    expect(await store!.counts("yt-main")).toContain("published: 1");
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
    expect(await second!.counts("yt-main")).toContain("excluded: 5");
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
