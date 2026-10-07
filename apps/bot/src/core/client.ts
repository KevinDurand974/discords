import { ActivityType, Client, GatewayIntentBits, Partials } from "discord.js";

export const createDiscordClient = () =>
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
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
