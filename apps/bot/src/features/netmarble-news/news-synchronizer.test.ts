import { describe, expect, it, vi } from "vitest";
import { createNewsSynchronizer } from "./news-synchronizer.ts";
import { NEWS_TAGS, type NewsSetup } from "./news-setup.ts";
import type { NewsArticle, NewsSource } from "./news-api.ts";
import type { NewsPublisher } from "./news-publisher.ts";
import type { KnownArticle, NewsPublicationStore } from "./news-publication-repository.ts";
import type { NewsSetupStore } from "./news-setup.ts";

function fixture(mode: NewsSetup["initialImportMode"] = "backfill") {
  const articles: NewsArticle[] = Array.from({ length: 15 }, (_, index) => ({
    id: index + 1,
    menuSeq: NEWS_TAGS[index % 5]!.menuSeq,
    title: `Article ${index + 1}`,
    excerpt: "Excerpt",
    bodyHtml: "<p>Hello</p>",
    canonicalUrl: "https://example.com",
    createdAt: new Date(2026, 0, index + 1).toISOString(),
    isSourcePinned: index === 0,
  })).reverse();
  const saved = new Map<number, KnownArticle["state"]>();
  const pinned = new Set<number>();
  const setup: NewsSetup = {
    guildId: "guild",
    forumChannelId: "forum",
    enabled: true,
    initialImportMode: mode,
    initialBackfillCount: 10,
    initialImportCompleted: false,
    mappings: NEWS_TAGS.map(({ menuSeq }, index) => ({
      menuSeq,
      tagId: `tag-${index}`,
      notificationRoleId: `role-${index}`,
    })),
  };
  const source: NewsSource = {
    list: vi.fn(async () => ({ articles, failures: [] })),
    detail: vi.fn(async (id) => articles.find((a) => a.id === id)!),
  };
  const setups: NewsSetupStore = {
    get: vi.fn(async () => setup),
    save: vi.fn(),
    setEnabled: vi.fn(),
    publicationCount: vi.fn(async () => 0),
    delete: vi.fn(async () => true),
  };
  const store: NewsPublicationStore = {
    enabledGuildIds: vi.fn(async () => ["guild"]),
    known: vi.fn(async () =>
      [...saved].map(([id, state]) => ({
        id,
        state,
        threadId: state === "published" ? `thread-${id}` : null,
        discordPinned: pinned.has(id),
      })),
    ),
    updateSourcePins: vi.fn(async () => {}),
    setDiscordPinned: vi.fn(async (_, id, value) => {
      if (value) pinned.add(id);
      else pinned.delete(id);
    }),
    initializeCutoff: vi.fn(async (_, article) => {
      setup.initialSourceCutoff ??= { id: article.id, createdAt: article.createdAt };
      return setup.initialSourceCutoff;
    }),
    publish: vi.fn(async (_, article) => {
      saved.set(article.id, "published");
    }),
    completeInitial: vi.fn(async () => {
      setup.initialImportCompleted = true;
    }),
  };
  const publisher: NewsPublisher = {
    publish: vi.fn(async (_, article) => `thread-${article.id}`),
    setPin: vi.fn(async () => true),
  };
  return {
    articles,
    saved,
    pinned,
    setup,
    source,
    setups,
    store,
    publisher,
    sync: createNewsSynchronizer(source, setups, store, publisher),
  };
}

describe("news synchronization", () => {
  it("pauses new publication and waits for in-flight work before cleanup", async () => {
    const f = fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(f.publisher.publish).mockImplementationOnce(async (_, article) => {
      await pending;
      return `thread-${article.id}`;
    });
    const syncing = f.sync.syncGuild("guild");
    await vi.waitFor(() => expect(f.publisher.publish).toHaveBeenCalledOnce());
    const cleanup = vi.fn(async () => {
      expect(f.store.publish).toHaveBeenCalledTimes(11);
      return "removed";
    });
    const cleaning = f.sync.withGuildCleanup("guild", cleanup);
    await expect(f.sync.syncGuild("guild", { mode: "backfill" })).rejects.toThrow(
      "cleanup is running",
    );
    await expect(f.sync.withGuildSetup("guild", async () => {})).rejects.toThrow(
      "cleanup is running",
    );
    expect(cleanup).not.toHaveBeenCalled();
    release();
    await syncing;
    expect(await cleaning).toBe("removed");
    await expect(f.sync.withGuildCleanup("guild", async () => "again")).resolves.toBe("again");
  });

  it("waits for an ongoing setup operation before cleanup", async () => {
    const f = fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setup = f.sync.withGuildSetup("guild", () => pending);
    const cleanup = vi.fn(async () => true);
    const cleaning = f.sync.withGuildCleanup("guild", cleanup);
    expect(cleanup).not.toHaveBeenCalled();
    release();
    await setup;
    expect(await cleaning).toBe(true);
  });
  it("imports the latest ten plus older pinned without notifying, then deduplicates", async () => {
    const f = fixture();
    const first = await f.sync.syncGuild("guild");
    expect(first).toEqual({ published: 11, skipped: 4, failures: [], initial: true });
    expect(f.saved.get(1)).toBe("published");
    expect(f.publisher.publish).toHaveBeenCalledTimes(11);
    expect(
      vi.mocked(f.publisher.publish).mock.calls.every(([, , notify]) => notify === false),
    ).toBe(true);
    expect((await f.sync.syncGuild("guild")).published).toBe(0);
    expect(f.publisher.publish).toHaveBeenCalledTimes(11);
  });

  it("imports five articles plus only one preferred pin, even with multiple source pins", async () => {
    const f = fixture();
    f.setup.initialBackfillCount = 5;
    [9, 10, 14].forEach((id) => {
      f.articles.find((article) => article.id === id)!.isSourcePinned = true;
    });
    const onProgress = vi.fn();
    expect(await f.sync.syncGuild("guild", { onProgress })).toMatchObject({
      published: 6,
      skipped: 9,
    });
    expect([...f.saved.keys()]).toEqual([15, 14, 13, 12, 11, 1]);
    expect(onProgress.mock.lastCall?.[0]).toMatchObject({ completed: 6, total: 6 });
    expect(f.publisher.setPin).toHaveBeenCalledWith(f.setup, "thread-1", true);
    expect((await f.sync.syncGuild("guild")).published).toBe(0);
    expect(f.saved.has(9)).toBe(false);
    expect(f.saved.has(10)).toBe(false);
  });

  it("counts the preferred pin separately when it is among the newest articles", async () => {
    const f = fixture();
    f.setup.initialBackfillCount = 5;
    f.articles.find((article) => article.id === 11)!.isSourcePinned = true;
    expect((await f.sync.syncGuild("guild")).published).toBe(6);
    expect([...f.saved.keys()]).toEqual([15, 14, 13, 12, 11, 10]);
    expect(f.saved.has(1)).toBe(false);
    expect(f.publisher.setPin).toHaveBeenCalledWith(f.setup, "thread-11", true);
  });

  it("imports five available articles when there is no source pin", async () => {
    const f = fixture();
    f.setup.initialBackfillCount = 5;
    f.articles.forEach((article) => {
      article.isSourcePinned = false;
    });
    expect((await f.sync.syncGuild("guild")).published).toBe(5);
    expect([...f.saved.keys()]).toEqual([15, 14, 13, 12, 11]);
  });

  it("imports only one preferred pin at count zero, not all source pins", async () => {
    const f = fixture("future_only");
    f.setup.initialBackfillCount = 0;
    [11, 14, 15].forEach((id) => {
      f.articles.find((article) => article.id === id)!.isSourcePinned = true;
    });
    expect((await f.sync.syncGuild("guild")).published).toBe(1);
    expect([...f.saved.keys()]).toEqual([11]);
    expect((await f.sync.syncGuild("guild")).published).toBe(0);
  });

  it("uses the newest source pin when none are Notices", async () => {
    const f = fixture("future_only");
    f.setup.initialBackfillCount = 0;
    f.articles.find((article) => article.id === 1)!.isSourcePinned = false;
    [14, 15].forEach((id) => {
      f.articles.find((article) => article.id === id)!.isSourcePinned = true;
    });
    expect((await f.sync.syncGuild("guild")).published).toBe(1);
    expect([...f.saved.keys()]).toEqual([15]);
    expect(f.publisher.setPin).toHaveBeenCalledWith(f.setup, "thread-15", true);
  });

  it("stores only published articles, not skipped initialization attempts", async () => {
    const f = fixture("future_only");
    await f.sync.syncGuild("guild");
    expect([...f.saved.keys()]).toEqual([1]);
    expect(f.store.publish).toHaveBeenCalledOnce();
    expect(f.store.initializeCutoff).toHaveBeenCalledOnce();
    await f.sync.syncGuild("guild");
    expect([...f.saved.keys()]).toEqual([1]);
  });

  it("reports initial and per-article progress, excluding already published articles", async () => {
    const f = fixture();
    f.setup.initialBackfillCount = 2;
    f.saved.set(15, "published");
    const onProgress = vi.fn();
    await f.sync.syncGuild("guild", { onProgress });
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { completed: 0, total: 2, published: 0, failed: 0 },
      { completed: 1, total: 2, published: 1, failed: 0 },
      { completed: 2, total: 2, published: 2, failed: 0 },
    ]);
  });

  it("counts failed articles as processed and continues reporting progress", async () => {
    const f = fixture();
    f.setup.initialBackfillCount = 1;
    vi.mocked(f.source.detail).mockRejectedValueOnce(new Error("Unavailable"));
    const onProgress = vi.fn();
    const result = await f.sync.syncGuild("guild", { onProgress });
    expect(result.failures).toHaveLength(1);
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { completed: 0, total: 2, published: 0, failed: 0 },
      { completed: 1, total: 2, published: 0, failed: 1 },
      { completed: 2, total: 2, published: 1, failed: 1 },
    ]);
  });

  it("reports an empty import and still completes setup", async () => {
    const f = fixture("future_only");
    f.setup.initialBackfillCount = 0;
    f.articles.forEach((article) => {
      article.isSourcePinned = false;
    });
    const onProgress = vi.fn();
    await f.sync.syncGuild("guild", { onProgress });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith({
      completed: 0,
      total: 0,
      published: 0,
      failed: 0,
    });
    expect(f.store.completeInitial).toHaveBeenCalledOnce();
  });

  it("does not interrupt publication when progress reporting fails", async () => {
    const f = fixture();
    const onProgress = vi.fn(async () => {
      throw new Error("Reply expired");
    });
    expect(await f.sync.syncGuild("guild", { onProgress })).toMatchObject({
      published: 11,
      failures: [],
    });
    expect(f.store.completeInitial).toHaveBeenCalledOnce();
  });

  it("imports only source-pinned posts when the initial count is zero", async () => {
    const f = fixture("future_only");
    f.setup.initialBackfillCount = 0;
    expect(await f.sync.syncGuild("guild")).toMatchObject({
      published: 1,
      skipped: 14,
      failures: [],
    });
    expect([...f.saved.keys()]).toEqual([1]);
    expect(f.setup.initialImportCompleted).toBe(true);
    expect(vi.mocked(f.publisher.publish).mock.lastCall?.[2]).toBe(false);
    expect((await f.sync.syncGuild("guild")).published).toBe(0);
  });

  it("imports nothing at count zero without pins and publishes only future news after restart", async () => {
    const f = fixture("future_only");
    f.setup.initialBackfillCount = 0;
    f.articles.forEach((article) => {
      article.isSourcePinned = false;
    });
    expect(await f.sync.syncGuild("guild")).toMatchObject({ published: 0, failures: [] });
    expect(f.source.detail).not.toHaveBeenCalled();
    expect(f.store.publish).not.toHaveBeenCalled();
    expect(f.store.completeInitial).toHaveBeenCalledOnce();
    const restarted = createNewsSynchronizer(f.source, f.setups, f.store, f.publisher);
    expect((await restarted.syncGuild("guild")).published).toBe(0);
    f.articles.unshift({ ...f.articles[0]!, id: 16 });
    expect((await restarted.syncGuild("guild")).published).toBe(1);
    expect([...f.saved.keys()]).toEqual([16]);
    expect(vi.mocked(f.publisher.publish).mock.lastCall?.[2]).toBe(true);
  });

  it("still rejects a zero count for manual backfills", async () => {
    const f = fixture();
    await expect(f.sync.syncGuild("guild", { mode: "backfill", count: 0 })).rejects.toThrow(
      "between 1 and 50",
    );
  });

  it("limits scheduled imports to the ten newest articles across all categories", async () => {
    const f = fixture();
    f.setup.initialImportCompleted = true;
    const result = await f.sync.syncGuild("guild");
    expect(result).toMatchObject({ published: 10, skipped: 0, initial: false });
    expect([...f.saved.keys()].sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(f.source.detail).toHaveBeenCalledTimes(10);
    expect(f.saved.has(1)).toBe(false); // Even a source pin outside the ten is not posted.
    expect((await f.sync.syncGuild("guild")).published).toBe(0);
  });

  it("does not import older missing articles when the newest ten span multiple categories", async () => {
    const f = fixture();
    f.setup.initialImportCompleted = true;
    f.articles.unshift(
      { ...f.articles[0]!, id: 17, menuSeq: NEWS_TAGS[0]!.menuSeq },
      { ...f.articles[0]!, id: 16, menuSeq: NEWS_TAGS[0]!.menuSeq },
    );
    await f.sync.syncGuild("guild");
    expect([...f.saved.keys()].sort((a, b) => a - b)).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(f.publisher.publish).toHaveBeenCalledTimes(10);
  });

  it("pins a Notices article ahead of newer pinned categories", async () => {
    const f = fixture();
    f.setup.initialBackfillCount = 2;
    f.articles[0]!.isSourcePinned = true;
    await f.sync.syncGuild("guild");
    expect(f.publisher.setPin).toHaveBeenCalledWith(f.setup, "thread-1", true);
    expect(f.publisher.setPin).not.toHaveBeenCalledWith(f.setup, "thread-15", true);
  });

  it("pins the newest source pin when no Notices article is pinned", async () => {
    const f = fixture();
    f.articles.find((article) => article.id === 1)!.isSourcePinned = false;
    f.articles[0]!.isSourcePinned = true;
    await f.sync.syncGuild("guild");
    expect(f.publisher.setPin).toHaveBeenCalledWith(f.setup, "thread-15", true);
  });

  it("unpins a previously imported post and pins the new preferred post without reposting", async () => {
    const f = fixture();
    await f.sync.syncGuild("guild");
    expect(f.pinned.has(1)).toBe(true);
    f.articles.find((article) => article.id === 1)!.isSourcePinned = false;
    f.articles.find((article) => article.id === 11)!.isSourcePinned = true; // Also Notices.
    vi.mocked(f.publisher.publish).mockClear();
    await f.sync.syncGuild("guild");
    expect(f.publisher.publish).not.toHaveBeenCalled();
    expect(f.publisher.setPin).toHaveBeenCalledWith(f.setup, "thread-1", false);
    expect(f.publisher.setPin).toHaveBeenCalledWith(f.setup, "thread-11", true);
    expect([...f.pinned]).toEqual([11]);
  });

  it("does not pin a replacement until the previous pin can be removed", async () => {
    const f = fixture();
    await f.sync.syncGuild("guild");
    f.articles.find((article) => article.id === 1)!.isSourcePinned = false;
    f.articles.find((article) => article.id === 11)!.isSourcePinned = true;
    vi.mocked(f.publisher.setPin).mockClear().mockRejectedValueOnce(new Error("No access"));
    const first = await f.sync.syncGuild("guild");
    expect(first.failures).toEqual(["Unpin 1: No access"]);
    expect(f.publisher.setPin).not.toHaveBeenCalledWith(f.setup, "thread-11", true);
    expect(f.pinned.has(1)).toBe(true);
    const second = await f.sync.syncGuild("guild");
    expect(second.failures).toEqual([]);
    expect([...f.pinned]).toEqual([11]);
  });

  it("does not report or record a pin for a manually deleted Discord thread", async () => {
    const f = fixture();
    vi.mocked(f.publisher.setPin).mockResolvedValue(false);
    const first = await f.sync.syncGuild("guild");
    expect(first.failures).toEqual([]);
    expect(f.store.setDiscordPinned).not.toHaveBeenCalledWith("guild", 1, true);
    expect(f.pinned.has(1)).toBe(false);
    expect(f.store.completeInitial).toHaveBeenCalledOnce();
    const second = await f.sync.syncGuild("guild");
    expect(second.failures).toEqual([]);
    expect(f.publisher.publish).toHaveBeenCalledTimes(11);
  });

  it("clears a previously recorded pin if its Discord thread was deleted", async () => {
    const f = fixture();
    await f.sync.syncGuild("guild");
    expect(f.pinned.has(1)).toBe(true);
    vi.mocked(f.publisher.setPin).mockResolvedValue(false);
    const result = await f.sync.syncGuild("guild");
    expect(result.failures).toEqual([]);
    expect(f.store.setDiscordPinned).toHaveBeenCalledWith("guild", 1, false);
    expect(f.pinned.has(1)).toBe(false);
  });

  it("retries a failed pin on the existing thread and continues publishing other articles", async () => {
    const f = fixture();
    vi.mocked(f.publisher.setPin).mockRejectedValueOnce(new Error("Missing permission"));
    const first = await f.sync.syncGuild("guild");
    expect(first.published).toBe(11);
    expect(first.failures).toEqual(["Pin 1: Missing permission"]);
    expect(f.store.completeInitial).not.toHaveBeenCalled();
    vi.mocked(f.publisher.publish).mockClear();
    const second = await f.sync.syncGuild("guild");
    expect(second.failures).toEqual([]);
    expect(f.publisher.publish).not.toHaveBeenCalled();
    expect(f.pinned.has(1)).toBe(true);
  });

  it("imports an excluded article in the latest ten if it becomes source-pinned, without a role mention", async () => {
    const f = fixture("future_only");
    await f.sync.syncGuild("guild");
    f.articles.find((article) => article.id === 11)!.isSourcePinned = true;
    f.articles.find((article) => article.id === 5)!.isSourcePinned = true;
    await f.sync.syncGuild("guild");
    expect(f.saved.get(11)).toBe("published");
    expect(f.saved.has(5)).toBe(false);
    expect(vi.mocked(f.publisher.publish).mock.lastCall?.[2]).toBe(false);
  });

  it("publishes healthy categories without clearing pins when another category fails", async () => {
    const f = fixture();
    vi.mocked(f.source.list).mockResolvedValueOnce({
      articles: f.articles.filter((article) => article.menuSeq === 32),
      failures: ["Category 13: API unavailable"],
    });
    const result = await f.sync.syncGuild("guild");
    expect(result.published).toBeGreaterThan(0);
    expect(result.failures).toEqual(["Category 13: API unavailable"]);
    expect(f.store.updateSourcePins).not.toHaveBeenCalled();
    expect(f.store.completeInitial).not.toHaveBeenCalled();
  });

  it("keeps importing later articles when one detail request fails", async () => {
    const f = fixture();
    vi.mocked(f.source.detail).mockRejectedValueOnce(new Error("Bad HTML upstream"));
    const result = await f.sync.syncGuild("guild");
    expect(result.failures).toHaveLength(1);
    expect(result.published).toBe(10);
    expect(f.publisher.publish).toHaveBeenCalledTimes(10);
  });

  it("persists and honors a custom initial backfill count on scheduled runs", async () => {
    const f = fixture();
    f.setup.initialBackfillCount = 2;
    expect(await f.sync.syncGuild("guild")).toMatchObject({ published: 3, skipped: 12 });
  });

  it("future-only stores only published pins and uses one cutoff to notify new live items", async () => {
    const f = fixture("future_only");
    expect(await f.sync.syncGuild("guild")).toMatchObject({ published: 1, skipped: 14 });
    expect(f.saved.has(15)).toBe(false);
    f.articles.unshift({ ...f.articles[0]!, id: 16 });
    expect(await f.sync.syncGuild("guild")).toMatchObject({ published: 1, skipped: 0 });
    expect(vi.mocked(f.publisher.publish).mock.lastCall?.[2]).toBe(true);
    expect((await f.sync.syncGuild("guild")).published).toBe(0);
  });

  it("preserves the cutoff across synchronizer recreation and retries", async () => {
    const f = fixture("future_only");
    vi.mocked(f.publisher.publish).mockRejectedValueOnce(new Error("Discord failed"));
    await f.sync.syncGuild("guild");
    const cutoff = { ...f.setup.initialSourceCutoff! };
    f.articles.unshift({ ...f.articles[0]!, id: 16, createdAt: "2026-02-01T00:00:00Z" });
    const restarted = createNewsSynchronizer(f.source, f.setups, f.store, f.publisher);
    await restarted.syncGuild("guild");
    expect(f.setup.initialSourceCutoff).toEqual(cutoff);
    expect(f.store.initializeCutoff).toHaveBeenCalledOnce();
    expect(f.saved.has(15)).toBe(false);
    expect((await restarted.syncGuild("guild")).published).toBe(1);
    expect(f.saved.has(16)).toBe(true);
  });

  it("does not publish old unrecorded articles when they reappear in the latest listing", async () => {
    const f = fixture("future_only");
    await f.sync.syncGuild("guild");
    f.articles.splice(0, 5);
    expect((await f.sync.syncGuild("guild")).published).toBe(0);
    expect([...f.saved.keys()]).toEqual([1]);
  });

  it("manual backfill imports previously excluded items without notifications or duplicate posts", async () => {
    const f = fixture("future_only");
    await f.sync.syncGuild("guild");
    expect(await f.sync.syncGuild("guild", { mode: "backfill", count: 3 })).toMatchObject({
      published: 3,
      initial: false,
    });
    expect(
      vi.mocked(f.publisher.publish).mock.calls.every(([, , notify]) => notify === false),
    ).toBe(true);
    expect((await f.sync.syncGuild("guild", { mode: "backfill", count: 3 })).published).toBe(0);
  });

  it("keeps the initial import pending on publication failure, then retries without a role ping", async () => {
    const f = fixture();
    vi.mocked(f.publisher.publish).mockRejectedValueOnce(new Error("Discord failed"));
    const first = await f.sync.syncGuild("guild");
    expect(first.failures).toHaveLength(1);
    expect(f.store.completeInitial).not.toHaveBeenCalled();
    expect((await f.sync.syncGuild("guild")).published).toBe(1);
    expect(f.store.completeInitial).toHaveBeenCalledOnce();
    expect(
      vi.mocked(f.publisher.publish).mock.calls.every(([, , notify]) => notify === false),
    ).toBe(true);
  });
});
