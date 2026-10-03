import type { Client } from "discord.js";
import { createNewsSource } from "./news-api.ts";
import { createNewsPublisher } from "./news-publisher.ts";
import { createNewsPublicationRepository } from "./news-publication-repository.ts";
import { createNewsSetupRepository } from "./news-setup-repository.ts";
import { createNewsSynchronizer } from "./news-synchronizer.ts";

const runtimes = new WeakMap<
  Client,
  {
    synchronizer: ReturnType<typeof createNewsSynchronizer>;
    publications: ReturnType<typeof createNewsPublicationRepository>;
  }
>();

export function createNewsRuntime(client: Client) {
  const existing = runtimes.get(client);
  if (existing) return existing;
  const setups = createNewsSetupRepository();
  const publications = createNewsPublicationRepository();
  const synchronizer = createNewsSynchronizer(
    createNewsSource(
      process.env.NEWS_API_URL ?? "http://localhost:3000",
      process.env.NEWS_INTERNAL_TOKEN,
    ),
    setups,
    publications,
    createNewsPublisher(client),
  );
  const runtime = { synchronizer, publications };
  runtimes.set(client, runtime);
  return runtime;
}

export async function synchronizeNews(client: Client) {
  if (!process.env.DATABASE_URL)
    throw new Error("News synchronization is inactive: DATABASE_URL is not configured.");
  const { synchronizer, publications } = createNewsRuntime(client);
  const guildIds = await publications.enabledGuildIds();
  await Promise.all(
    guildIds.map(async (guildId) => {
      try {
        const result = await synchronizer.syncGuild(guildId);
        if (result.failures.length)
          console.error(`News synchronization failed in ${guildId}`, result.failures);
        else
          console.info("News guild synchronization succeeded", {
            guildId,
            published: result.published,
            skipped: result.skipped,
            at: new Date().toISOString(),
          });
      } catch (error) {
        console.error(`News synchronization failed in ${guildId}`, error);
      }
    }),
  );
}
