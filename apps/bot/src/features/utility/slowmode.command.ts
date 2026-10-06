import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";

export const slowmodeHelpDescription = [
  "Sets slowmode in seconds, from 0 to 21600 (6 hours). Use 0 to disable it. Channel defaults to the current channel; only the selected channel is changed. Confirmation is private.",
  "Server text or announcement channels only. Both you and the bot need Manage Channels in the destination.",
  "Example: `/slowmode duration:30 channel:#general`",
] as const;

export const slowmodeCommand = {
  helpDescription: slowmodeHelpDescription,
  data: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set a channel's slowmode in seconds (0 to disable)")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((option) =>
      option
        .setName("duration")
        .setDescription("Seconds between messages, from 0 (disabled) to 21600 (6 hours)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600),
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to configure (default: the current channel)")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
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
    const selectedChannel = interaction.options.getChannel("channel");
    const channel = await interaction.guild.channels.fetch(
      selectedChannel?.id ?? interaction.channelId,
      { force: true },
    );
    if (
      !channel ||
      channel.guildId !== interaction.guild.id ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
    ) {
      throw new Error("Choose a text or announcement channel in this server.");
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
      duration === 0
        ? `Slowmode disabled${selectedChannel ? ` in <#${channel.id}>` : ""}.`
        : `Slowmode set to ${duration} seconds${selectedChannel ? ` in <#${channel.id}>` : ""}.`,
    );
  },
} satisfies CommandDefinition;
