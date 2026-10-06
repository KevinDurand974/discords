import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { createPickModal } from "./pick-components.ts";

export const pickCommand = {
  data: new SlashCommandBuilder()
    .setName("pick")
    .setDescription("Choose randomly from options entered one per line"),
  async execute(interaction) {
    await interaction.showModal(createPickModal(interaction.user.id));
  },
} satisfies CommandDefinition;
