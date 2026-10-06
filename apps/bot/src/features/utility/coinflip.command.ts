import { randomInt } from "node:crypto";
import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { displayEmoji } from "@/shared/emojis/emoji-cache.ts";

export const coinflipCommand = {
  data: new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Flip a coin using cryptographically secure randomness"),
  async execute(interaction) {
    const heads = randomInt(0, 2) === 0;
    const outcome = heads ? "Heads" : "Tails";
    const emoji = displayEmoji(heads ? "coinflip_1" : "coinflip_2");
    await interaction.reply({
      content: `# ${emoji} **${outcome}**`,
      allowedMentions: { parse: [] },
    });
  },
} satisfies CommandDefinition;
