import { expect, it } from "vitest";
import { GatewayIntentBits, Partials } from "discord.js";
import { createDiscordClient } from "./client.ts";

it("receives guild messages and membership events without requesting message content", async () => {
  const client = createDiscordClient();
  expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
  expect(client.options.intents.has(GatewayIntentBits.GuildMessages)).toBe(true);
  expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(false);
  expect(client.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(true);
  expect(client.options.intents.has(GatewayIntentBits.GuildMessageReactions)).toBe(true);
  expect(client.options.partials).toEqual([
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
  ]);
  await client.destroy();
});
