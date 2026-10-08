import {
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits as P,
  type ChatInputCommandInteraction,
} from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import type { TrapStore } from "./trap-repository.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";

export async function removeTrap(interaction: ChatInputCommandInteraction, store: TrapStore) {
  if (!interaction.inGuild() || !interaction.guild)
    throw new UserFacingError("Use this command in a server.");
  const guild = interaction.guild;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = await guild.members.fetch({ user: interaction.user.id, force: true });
  if (!member.permissions.has([P.ManageChannels, P.BanMembers]))
    throw new UserFacingError("You need Manage Channels and Ban Members to remove a bot trap.");
  const channelId = await store.getChannel(guild.id);
  if (!channelId) {
    await editSuccessReply(interaction, {
      content: "No bot trap is configured for this server.",
      allowedMentions: { parse: [] },
    });
    return;
  }
  // Disarm first, even if Discord cannot delete the channel; preserve any concurrent replacement.
  await store.clearChannel(guild.id, channelId);
  try {
    const channel = await guild.channels.fetch(channelId, { force: true });
    if (channel) {
      if (channel.guildId !== guild.id)
        throw new Error("The stored channel belongs to another server.");
      const bot = await guild.members.fetchMe({ force: true });
      if (!channel.permissionsFor(bot)?.has(P.ManageChannels))
        throw new Error("The bot needs Manage Channels in the trap channel.");
      await channel.delete(`Bot trap removed by ${interaction.user.id}`);
    }
  } catch (error) {
    if (!(error instanceof DiscordAPIError && error.code === 10003)) {
      console.error("[Trap bot] Monitoring disabled but channel cleanup failed", error);
      throw new UserFacingError(
        "Bot trap disabled, but I couldn't delete the channel. Please delete it manually.",
      );
    }
  }
  await editSuccessReply(interaction, {
    content: "Bot trap removed. The trap is now disabled.",
    allowedMentions: { parse: [] },
  });
}
