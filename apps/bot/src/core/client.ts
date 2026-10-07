import { ActivityType, Client, GatewayIntentBits } from "discord.js";

export const createDiscordClient = () =>
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
    ],
    presence: {
      activities: [
        {
          name: "Custom Status",
          state: "/help for more informations",
          type: ActivityType.Custom,
        },
      ],
    },
  });
