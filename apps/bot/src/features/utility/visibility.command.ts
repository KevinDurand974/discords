import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import type { CommandDefinition } from "@/core/command.ts";
import { createVisibilityModal } from "./visibility-modal.ts";
import {
  getChannelVisibility,
  getVisibilityChannel,
  visibilityChannelTypes,
} from "./visibility.ts";

export const visibilityHelpDescription = [
  "Opens a modal with Default, Spoiler Channel and Age-Restricted Channel, preselecting the current setting. Channel defaults to the current channel. Nothing changes until you submit.",
  "Changes content warnings, not role/member access permissions. Text, announcement, forum, media and voice channels are supported; threads inherit their parent's setting. Both you and the bot need View Channel and Manage Channels in the destination, checked again on submission. Confirmation is private.",
  "Example: `/visibility channel:#general`",
] as const;

export const visibilityCommand = {
  helpDescription: visibilityHelpDescription,
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
      throw new UserFacingError("Use this command in a server.");
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
