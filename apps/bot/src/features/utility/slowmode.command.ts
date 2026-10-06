import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";

export const slowmodeCommand = {
  data: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set this channel's slowmode in seconds (0 to disable)")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((option) =>
      option
        .setName("duration")
        .setDescription("Seconds between messages, from 0 (disabled) to 21600 (6 hours)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new Error("Slowmode can only be configured in a server.");
    }
    const duration = interaction.options.getInteger("duration", true);
    if (!Number.isInteger(duration) || duration < 0 || duration > 21600) {
      throw new Error("Duration must be a whole number between 0 and 21600 seconds.");
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await interaction.guild.channels.fetch(interaction.channelId, { force: true });
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
    ) {
      throw new Error("Run this command in a text or announcement channel.");
    }
    const member = await interaction.guild.members.fetch({
      user: interaction.user.id,
      force: true,
    });
    if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageChannels)) {
      throw new Error("You need Manage Channels in this channel to configure slowmode.");
    }
    const bot = await interaction.guild.members.fetchMe({ force: true });
    if (!channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels)) {
      throw new Error("The bot needs Manage Channels in this channel to configure slowmode.");
    }
    await channel.setRateLimitPerUser(duration, `Slowmode requested by ${interaction.user.id}`);
    await interaction.editReply(
      duration === 0 ? "Slowmode disabled." : `Slowmode set to ${duration} seconds.`,
    );
  },
} satisfies CommandDefinition;
