import { expect, it } from "vitest";
import { GatewayIntentBits } from "discord.js";
import { createDiscordClient } from "./client.ts";

it("receives guild messages and membership events without requesting message content", async () => {
  const client = createDiscordClient();
  expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
  expect(client.options.intents.has(GatewayIntentBits.GuildMessages)).toBe(true);
  expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(false);
  expect(client.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(true);
  await client.destroy();
});
