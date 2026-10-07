import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { clearMessages, parseClearDuration } from "./clear-messages.ts";

export const clearHelpDescription = [
  "Deletes 1–100 messages; count defaults to 10. Channel defaults to the current channel. With user, searches only the latest 100 messages for that user's messages. Reports the actual deletion count privately.",
  "Recent messages are bulk-deleted; messages 14 days old or older are deleted sequentially, which can take longer. Duration accepts a positive whole number followed by m, h, d or w, including periods beyond 14 days. A duration filters candidates; it does not delete every message in that period.",
  "Server only: text/announcement channels and active unlocked threads. You need View Channel and Manage Messages in the destination; the bot also needs Read Message History. Both need membership or Manage Threads in private threads.",
  "Example: `/clear count:100 duration:6h channel:#general`",
] as const;

export const clearCommand = {
  helpDescription: clearHelpDescription,
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete messages in a channel, including messages older than 14 days")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName("count")
        .setDescription("Number of messages to delete, from 1 to 100 (default: 10)")
        .setMinValue(1)
        .setMaxValue(100),
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Only delete this user's messages among the latest 100 messages"),
    )
    .addStringOption((option) =>
      option
        .setName("duration")
        .setDescription("Only delete messages from this period: 30m, 6h, 3d, 2w, 30d"),
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to clear (default: the current channel)")
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread,
        ),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new Error("Messages can only be cleared in a server.");
    }
    const count = interaction.options.getInteger("count") ?? 10;
    const user = interaction.options.getUser("user");
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new Error("Count must be a whole number between 1 and 100.");
    }
    const duration = interaction.options.getString("duration");
    const maxAgeMs = duration === null ? undefined : parseClearDuration(duration);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const selectedChannel = interaction.options.getChannel("channel");
    const channel = await interaction.guild.channels.fetch(
      selectedChannel?.id ?? interaction.channelId,
      { force: true },
    );
    if (
      !channel ||
      channel.guildId !== interaction.guild.id ||
      (channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement &&
        !channel.isThread())
    ) {
      throw new Error("Choose a text or announcement channel, or a thread in this server.");
    }
    if (channel.isThread() && (channel.archived || channel.locked)) {
      throw new Error("Messages cannot be cleared in an archived or locked thread.");
    }
    const member = await interaction.guild.members.fetch({
      user: interaction.user.id,
      force: true,
    });
    if (
      !channel
        .permissionsFor(member)
        ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages])
    ) {
      throw new Error(
        "You need View Channel and Manage Messages in this channel to clear messages.",
      );
    }
    const bot = await interaction.guild.members.fetchMe({ force: true });
    if (
      !channel
        .permissionsFor(bot)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ])
    ) {
      throw new Error(
        "The bot needs View Channel, Read Message History and Manage Messages in this channel.",
      );
    }
    if (channel.isThread() && channel.type === ChannelType.PrivateThread) {
      const canAccess = await Promise.all(
        [member, bot].map(async (actor) =>
          channel.permissionsFor(actor)?.has(PermissionFlagsBits.ManageThreads)
            ? true
            : Boolean(await channel.members.fetch(actor.id).catch(() => null)),
        ),
      );
      if (canAccess.some((allowed) => !allowed)) {
        throw new Error(
          "Both you and the bot must be members of the private thread or have Manage Threads.",
        );
      }
    }
    const deleted = await clearMessages(channel, count, user?.id, maxAgeMs);
    await interaction.editReply(
      deleted === 0
        ? duration === null
          ? "No matching messages were found."
          : "No matching messages within the requested duration were found."
        : `Deleted ${deleted} message${deleted === 1 ? "" : "s"}${selectedChannel ? ` in <#${channel.id}>` : ""}.`,
    );
  },
} satisfies CommandDefinition;
