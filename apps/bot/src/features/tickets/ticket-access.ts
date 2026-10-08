import { ChannelType, PermissionFlagsBits, type Guild, type TextChannel } from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import { ticketOwnerId } from "./ticket-service.ts";

export async function authorizeTicket(guild: Guild, channelId: string, actorId: string) {
  const channel = await guild.channels.fetch(channelId, { force: true });
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new UserFacingError("Use /close-ticket inside a ticket text channel.");
  }
  const ownerId = ticketOwnerId(channel);
  if (!ownerId) throw new UserFacingError("Use /close-ticket inside a ticket text channel.");
  await guild.roles.fetch();
  const member = await guild.members.fetch({ user: actorId, force: true });
  const allowed =
    actorId === ownerId ||
    actorId === guild.ownerId ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.some(
      (role) =>
        role.id !== guild.id &&
        !role.managed &&
        role.permissions.has(PermissionFlagsBits.ManageMessages),
    );
  if (!allowed)
    throw new UserFacingError(
      "Only the ticket requester or a moderator can close or reopen this ticket.",
    );
  return { channel, ownerId };
}
export async function requireTicketDeletionPermission(guild: Guild, channel: TextChannel) {
  const bot = await guild.members.fetchMe({ force: true });
  if (!channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels)) {
    throw new UserFacingError("The bot needs Manage Channels in this ticket to delete it.");
  }
}
