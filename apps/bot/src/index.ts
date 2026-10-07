import { Collection, Events } from "discord.js";
import { createDatabase } from "@discords/db";
import { createCommandLogRepository } from "@/core/command-log-repository.ts";
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
import { deleteDueTickets } from "@/features/tickets/ticket-runtime.ts";
import { getTrapStore } from "@/features/trap-bot/trap-repository.ts";
import { registerTrapRuntime } from "@/features/trap-bot/trap-runtime.ts";
import { getWelcomeStore } from "@/features/welcome/welcome-repository.ts";
import { registerWelcomeRuntime } from "@/features/welcome/welcome-runtime.ts";

import { getReactionRoleStore } from "@/features/reaction-roles/reaction-role-repository.ts";
import { registerReactionRoleRuntime } from "@/features/reaction-roles/reaction-role-runtime.ts";
import {
  cleanupReactionRoles,
  registerReactionRoleCleanup,
} from "@/features/reaction-roles/reaction-role-cleanup.ts";

const client = createDiscordClient();
const healthPort = Number(process.env.BOT_HEALTH_PORT ?? "3001");
const healthHost = process.env.BOT_HEALTH_HOST ?? "127.0.0.1";
if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535)
  throw new Error("BOT_HEALTH_PORT must be between 1 and 65535");
createBotHealthServer(client, process.env.DATABASE_URL, {
  token: process.env.JOBS_INTERNAL_TOKEN,
  synchronizeNews: () => synchronizeNews(client),
  synchronizeVideos: () => synchronizeVideos(client),
  deleteDueTickets: () => deleteDueTickets(client),
  cleanupReactionRoles: () => cleanupReactionRoles(client),
}).listen(healthPort, healthHost, () => {
  console.info(`Bot health listening on ${healthHost}:${healthPort}`);
});
const logDatabase = createDatabase(ENV.DATABASE_URL);
const commandLogger = createCommandLogger(client, createCommandLogRepository(logDatabase));
registerTrapRuntime(client, getTrapStore(), commandLogger);
registerWelcomeRuntime(client, getWelcomeStore());
registerReactionRoleRuntime(client, getReactionRoleStore());
registerReactionRoleCleanup(client, getReactionRoleStore());
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
