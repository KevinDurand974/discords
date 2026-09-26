import { Collection, Events } from "discord.js";
import { createDiscordClient } from "@/core/client.ts";
import type { CommandDefinition } from "@/core/command.ts";
import { commands, componentHandlers } from "@/core/command-registry.ts";
import { ENV } from "@/core/config.ts";
import { registerInteractionRouter } from "@/core/interaction-router.ts";
import { fetchEmojis } from "@/shared/emojis/emoji-cache.ts";

const client = createDiscordClient();
const commandsByName = new Collection<string, CommandDefinition>();

commands.forEach((command) => {
  commandsByName.set(command.data.name, command);
});

registerInteractionRouter(client, commandsByName, componentHandlers);

client.once(Events.ClientReady, async (readyClient) => {
  console.clear();
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);

  await fetchEmojis(readyClient);
  commands.forEach((command) => {
    console.log(`[Success] Command: ${command.data.name} loaded`);
  });
});

await client.login(ENV.DISCORD_TOKEN);
