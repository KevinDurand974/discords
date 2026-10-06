import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { createVisibilityModal } from "./visibility-modal.ts";
import {
  getChannelVisibility,
  getVisibilityChannel,
  visibilityChannelTypes,
} from "./visibility.ts";

export const visibilityCommand = {
  data: new SlashCommandBuilder()
    .setName("visibility")
    .setDescription("Choose a channel's content visibility: default, spoiler or age-restricted")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to configure (default: the current channel)")
        .addChannelTypes(...visibilityChannelTypes),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new Error("Channel visibility can only be configured in a server.");
    }
    const selected = interaction.options.getChannel("channel");
    const channel = await getVisibilityChannel(interaction, selected?.id ?? interaction.channelId);
    await interaction.showModal(
      createVisibilityModal(
        interaction.user.id,
        interaction.guild.id,
        channel.id,
        getChannelVisibility(channel),
      ),
    );
  },
} satisfies CommandDefinition;
