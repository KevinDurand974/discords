import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { createPickModal } from "./pick-components.ts";

export const pickHelpDescription = [
  "Opens a multiline modal: one line = one option. Enter 2–50 options, at most 100 characters per option and 1500 characters total. Blank lines are ignored; repeated lines count as separate entries.",
  "Publishes the choices in Components V2 without added prefixes. Only the named creator can press Get result. A secure random draw updates the original message and disables the button; repeated clicks cannot reroll it. Pending draws expire after 15 minutes or a bot restart. No special permissions are required.",
  "Example: `/pick`",
] as const;

export const pickCommand = {
  helpDescription: pickHelpDescription,
  data: new SlashCommandBuilder()
    .setName("pick")
    .setDescription("Choose randomly from options entered one per line"),
  async execute(interaction) {
    await interaction.showModal(createPickModal(interaction.user.id));
  },
} satisfies CommandDefinition;
