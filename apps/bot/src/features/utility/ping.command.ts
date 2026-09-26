import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";

export const pingCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with pong!")
    .addBooleanOption((option) => option.setName("ephemeral").setDescription("Reply privately")),

  async execute(interaction) {
    const ephemeral = interaction.options.getBoolean("ephemeral") ?? true;
    const reply = await interaction.reply({
      content: "pong!",
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      withResponse: true,
    });

    await interaction.editReply(
      `pong!\nws: ${interaction.client.ws.ping}ms\nlatency: ${Math.max((reply.resource?.message?.createdTimestamp ?? 0) - interaction.createdTimestamp, 0)}ms`,
    );
  },
} satisfies CommandDefinition;
