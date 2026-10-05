import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { createPollModal } from "./poll-modal.ts";

export const pollCommand = {
  data: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Open a form to create a native Discord poll")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(null),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new Error("Polls can only be created in a server.");
    }
    await interaction.showModal(createPollModal(interaction));
  },
} satisfies CommandDefinition;
