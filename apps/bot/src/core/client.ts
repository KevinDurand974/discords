import { Client, GatewayIntentBits } from "discord.js";

export const createDiscordClient = () =>
  new Client({
    intents: [GatewayIntentBits.Guilds],
  });
