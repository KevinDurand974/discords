import { expect, it } from "vitest";
import { GatewayIntentBits } from "discord.js";
import { createDiscordClient } from "./client.ts";

it("receives guild messages without requesting privileged content or member intents", async () => {
  const client = createDiscordClient();
  expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
  expect(client.options.intents.has(GatewayIntentBits.GuildMessages)).toBe(true);
  expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(false);
  expect(client.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(false);
  await client.destroy();
});
