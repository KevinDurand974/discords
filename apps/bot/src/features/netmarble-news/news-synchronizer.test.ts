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
    list: vi.fn(async () => articles),
    detail: vi.fn(async (id) => articles.find((a) => a.id === id)!),
  };
  const setups: NewsSetupStore = {
    get: vi.fn(async () => setup),
    save: vi.fn(),
    setEnabled: vi.fn(),
  };
  const store: NewsPublicationStore = {
    enabledGuildIds: vi.fn(async () => ["guild"]),
    known: vi.fn(async () => [...saved].map(([id, state]) => ({ id, state }))),
    skip: vi.fn(async (_, article) => {
      if (!saved.has(article.id)) saved.set(article.id, "skipped");
    }),
    publish: vi.fn(async (_, article) => {
      saved.set(article.id, "published");
    }),
    completeInitial: vi.fn(async () => {
      setup.initialImportCompleted = true;
    }),
  };
  const publisher: NewsPublisher = { publish: vi.fn(async (_, article) => `thread-${article.id}`) };
  return {
    articles,
    saved,
    setup,
    source,
    setups,
    store,
    publisher,
    sync: createNewsSynchronizer(source, setups, store, publisher),
  };
}

describe("news synchronization", () => {
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

  it("pins a Notices article ahead of newer pinned categories", async () => {
    const f = fixture();
    f.setup.initialBackfillCount = 2;
    f.articles[0]!.isSourcePinned = true;
    await f.sync.syncGuild("guild");
    const calls = vi.mocked(f.publisher.publish).mock.calls;
    expect(calls.filter(([, , , pin]) => pin).map(([, article]) => article.id)).toEqual([1]);
    expect(calls.find(([, article]) => article.id === 15)?.[3]).toBe(false);
  });

  it("pins the newest source pin when no Notices article is pinned", async () => {
    const f = fixture();
    f.articles.find((article) => article.id === 1)!.isSourcePinned = false;
    f.articles[0]!.isSourcePinned = true;
    await f.sync.syncGuild("guild");
    expect(
      vi
        .mocked(f.publisher.publish)
        .mock.calls.filter(([, , , pin]) => pin)
        .map(([, article]) => article.id),
    ).toEqual([15]);
  });

  it("persists and honors a custom initial backfill count on scheduled runs", async () => {
    const f = fixture();
    f.setup.initialBackfillCount = 2;
    expect(await f.sync.syncGuild("guild")).toMatchObject({ published: 3, skipped: 12 });
  });

  it("future-only records all normal IDs as skipped, imports pinned, and only notifies new live items", async () => {
    const f = fixture("future_only");
    expect(await f.sync.syncGuild("guild")).toMatchObject({ published: 1, skipped: 14 });
    expect(f.saved.get(15)).toBe("skipped");
    f.articles.unshift({ ...f.articles[0]!, id: 16 });
    expect(await f.sync.syncGuild("guild")).toMatchObject({ published: 1, skipped: 0 });
    expect(vi.mocked(f.publisher.publish).mock.lastCall?.[2]).toBe(true);
    expect((await f.sync.syncGuild("guild")).published).toBe(0);
  });

  it("manual backfill imports previously skipped items without notifications or duplicate posts", async () => {
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
