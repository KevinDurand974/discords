import { Collection, Events } from "discord.js";
import { createDiscordClient } from "@/core/client.ts";
import { createCommandLogger } from "@/core/command-logger.ts";
import type { CommandDefinition } from "@/core/command.ts";
import { commands, componentHandlers } from "@/core/command-registry.ts";
import { ENV } from "@/core/config.ts";
import { createBotHealthServer } from "@/core/health.ts";
import { registerInteractionRouter } from "@/core/interaction-router.ts";
import { synchronizeNews } from "@/features/netmarble-news/news-runtime.ts";
import { synchronizeVideos } from "@/features/youtube-videos/videos-runtime.ts";
import { fetchEmojis } from "@/shared/emojis/emoji-cache.ts";

const client = createDiscordClient();
const healthPort = Number(process.env.BOT_HEALTH_PORT ?? "3001");
const healthHost = process.env.BOT_HEALTH_HOST ?? "127.0.0.1";
if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535)
  throw new Error("BOT_HEALTH_PORT must be between 1 and 65535");
createBotHealthServer(client, process.env.DATABASE_URL, {
  token: process.env.JOBS_INTERNAL_TOKEN,
  synchronizeNews: () => synchronizeNews(client),
  synchronizeVideos: () => synchronizeVideos(client),
}).listen(healthPort, healthHost, () => {
  console.info(`Bot health listening on ${healthHost}:${healthPort}`);
});
const commandLogger = await createCommandLogger(client);
const commandsByName = new Collection<string, CommandDefinition>();

commands.forEach((command) => {
  commandsByName.set(command.data.name, command);
});

registerInteractionRouter(client, commandsByName, componentHandlers, {
  commandLogger,
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);

  await fetchEmojis(readyClient);
  commands.forEach((command) => {
    console.log(`[Success] Command: ${command.data.name} loaded`);
  });
});

await client.login(ENV.DISCORD_TOKEN);
