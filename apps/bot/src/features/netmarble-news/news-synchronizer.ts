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
        const [listing, knownRows] = await Promise.all([source.list(), store.known(guildId)]);
        const { articles } = listing;
        const known = new Map(knownRows.map((row) => [row.id, row]));
        // Prefer a Notices article, then the newest source pin.
        const pinnedWinnerId = (
          articles.find(
            (article) => article.isSourcePinned && article.menuSeq === NOTICES_MENU_SEQ,
          ) ?? articles.find((article) => article.isSourcePinned)
        )?.id;
        const initial = !setup.initialImportCompleted && options.mode !== "backfill";
        const manual = options.mode === "backfill";
        const count = initial ? setup.initialBackfillCount : manual ? (options.count ?? 10) : 10;
        if (!Number.isInteger(count) || count < 1 || count > 50)
          throw new RangeError("Backfill count must be between 1 and 50.");
        const latest = new Set(articles.slice(0, count).map(({ id }) => id));
        const selected = articles.filter((article) =>
          manual
            ? latest.has(article.id)
            : initial
              ? article.isSourcePinned ||
                (setup.initialImportMode === "backfill" && latest.has(article.id))
              : latest.has(article.id) &&
                (!known.has(article.id) ||
                  (article.isSourcePinned && known.get(article.id)?.state === "skipped")),
        );
        let skipped = 0;
        if (initial) {
          const selectedIds = new Set(selected.map(({ id }) => id));
          await articles
            .filter(({ id }) => !selectedIds.has(id) && !known.has(id))
            .reduce<Promise<void>>(async (previous, article) => {
              await previous;
              await store.skip(guildId, article);
              known.set(article.id, {
                id: article.id,
                state: "skipped",
                threadId: null,
                discordPinned: false,
              });
              skipped += 1;
            }, Promise.resolve());
        }
        const failures: string[] = [...listing.failures];
        let published = 0;
        await selected.reduce<Promise<void>>(async (previous, article: NewsArticle) => {
          await previous;
          if (known.get(article.id)?.state === "published") return;
          if (
            known.get(article.id)?.state === "skipped" &&
            !initial &&
            !manual &&
            !article.isSourcePinned
          )
            return;
          try {
            const detail = await source.detail(article.id, article.menuSeq);
            if (detail.id !== article.id || detail.menuSeq !== article.menuSeq)
              throw new Error("News API returned the wrong article detail.");
            const threadId = await publisher.publish(
              setup,
              { ...detail, isSourcePinned: article.isSourcePinned },
              !initial && !manual && known.get(article.id)?.state !== "skipped",
            );
            await store.publish(guildId, article, threadId);
            known.set(article.id, {
              id: article.id,
              state: "published",
              threadId,
              discordPinned: false,
            });
            published += 1;
          } catch (error) {
            failures.push(
              `${article.id} (${article.menuSeq}): ${error instanceof Error ? error.message : String(error)}`,
            );
            console.error(`News article ${article.id} failed in ${guildId}`, error);
          }
        }, Promise.resolve());
        if (listing.failures.length === 0) {
          await store.updateSourcePins(
            guildId,
            articles.filter((article) => article.isSourcePinned).map((article) => article.id),
          );
          const unpinFailed = await Array.from(known.values())
            .filter((row): row is typeof row & { threadId: string } =>
              Boolean(row.discordPinned && row.id !== pinnedWinnerId && row.threadId),
            )
            .reduce<Promise<boolean>>(async (previous, row) => {
              const failed = await previous;
              try {
                await publisher.setPin(setup, row.threadId, false);
                await store.setDiscordPinned(guildId, row.id, false);
                row.discordPinned = false;
                return failed;
              } catch (error) {
                failures.push(
                  `Unpin ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
                );
                console.error(`Could not unpin news article ${row.id} in ${guildId}`, error);
                return true;
              }
            }, Promise.resolve(false));
          const winner = pinnedWinnerId === undefined ? undefined : known.get(pinnedWinnerId);
          if (!unpinFailed && winner?.state === "published" && winner.threadId) {
            try {
              const exists = await publisher.setPin(setup, winner.threadId, true);
              if (winner.discordPinned !== exists) {
                await store.setDiscordPinned(guildId, winner.id, exists);
                winner.discordPinned = exists;
              }
            } catch (error) {
              failures.push(
                `Pin ${winner.id}: ${error instanceof Error ? error.message : String(error)}`,
              );
              console.error(`Could not pin news article ${winner.id} in ${guildId}`, error);
            }
          }
        }
        if (initial && failures.length === 0) await store.completeInitial(guildId);
        return { published, skipped, failures, initial };
      } finally {
        inFlight.delete(guildId);
      }
    },
  };
}
