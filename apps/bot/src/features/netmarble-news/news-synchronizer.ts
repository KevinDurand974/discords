import type { NewsArticle, NewsSource } from "./news-api.ts";
import type { NewsPublisher } from "./news-publisher.ts";
import type { NewsPublicationStore } from "./news-publication-repository.ts";
import { NOTICES_MENU_SEQ, type NewsSetupStore } from "./news-setup.ts";

export type SyncOptions = { mode?: "automatic" | "backfill"; count?: number };
export type SyncResult = {
  published: number;
  skipped: number;
  failures: string[];
  initial: boolean;
};
export type NetmarbleNewsSynchronizer = {
  syncGuild(guildId: string, options?: SyncOptions): Promise<SyncResult>;
};

export function createNewsSynchronizer(
  source: NewsSource,
  setups: NewsSetupStore,
  store: NewsPublicationStore,
  publisher: NewsPublisher,
): NetmarbleNewsSynchronizer {
  const inFlight = new Set<string>();
  return {
    async syncGuild(guildId, options = {}) {
      if (inFlight.has(guildId))
        throw new Error(`News synchronization is already running for ${guildId}.`);
      inFlight.add(guildId);
      try {
        const setup = await setups.get(guildId);
        if (!setup?.enabled) throw new Error("News publishing is not enabled in this server.");
        const [articles, knownRows] = await Promise.all([source.list(), store.known(guildId)]);
        const known = new Map(knownRows.map(({ id, state }) => [id, state]));
        // A forum has one pinned post: prefer a Notices article, then the newest source pin.
        const pinnedWinnerId = (
          articles.find(
            (article) => article.isSourcePinned && article.menuSeq === NOTICES_MENU_SEQ,
          ) ?? articles.find((article) => article.isSourcePinned)
        )?.id;
        const initial = !setup.initialImportCompleted && options.mode !== "backfill";
        const manual = options.mode === "backfill";
        const count = initial ? setup.initialBackfillCount : (options.count ?? 10);
        if (!Number.isInteger(count) || count < 1 || count > 50)
          throw new RangeError("Backfill count must be between 1 and 50.");
        const latest = new Set(articles.slice(0, count).map(({ id }) => id));
        const selected = articles.filter((article) =>
          manual
            ? latest.has(article.id)
            : initial
              ? article.isSourcePinned ||
                (setup.initialImportMode === "backfill" && latest.has(article.id))
              : !known.has(article.id),
        );
        let skipped = 0;
        if (initial) {
          const selectedIds = new Set(selected.map(({ id }) => id));
          await articles
            .filter(({ id }) => !selectedIds.has(id) && !known.has(id))
            .reduce<Promise<void>>(async (previous, article) => {
              await previous;
              await store.skip(guildId, article);
              known.set(article.id, "skipped");
              skipped += 1;
            }, Promise.resolve());
        }
        const failures: string[] = [];
        let published = 0;
        await selected.reduce<Promise<void>>(async (previous, article: NewsArticle) => {
          await previous;
          if (known.get(article.id) === "published") return;
          if (known.get(article.id) === "skipped" && !initial && !manual) return;
          try {
            const detail = await source.detail(article.id, article.menuSeq);
            if (detail.id !== article.id || detail.menuSeq !== article.menuSeq)
              throw new Error("News API returned the wrong article detail.");
            const threadId = await publisher.publish(
              setup,
              { ...detail, isSourcePinned: article.isSourcePinned },
              !initial && !manual,
              article.id === pinnedWinnerId,
            );
            await store.publish(guildId, article, threadId);
            known.set(article.id, "published");
            published += 1;
          } catch (error) {
            failures.push(
              `${article.id} (${article.menuSeq}): ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }, Promise.resolve());
        if (initial && failures.length === 0) await store.completeInitial(guildId);
        return { published, skipped, failures, initial };
      } finally {
        inFlight.delete(guildId);
      }
    },
  };
}
