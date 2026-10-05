import type { Guild } from "discord.js";
import { authorizeTicket, requireTicketDeletionPermission } from "./ticket-access.ts";
import { scheduleTicketClosure } from "./ticket-runtime.ts";

export async function closeTicket(guild: Guild, channelId: string, actorId: string) {
  const { channel, ownerId } = await authorizeTicket(guild, channelId, actorId);
  await requireTicketDeletionPermission(guild, channel);
  return scheduleTicketClosure(
    { guildId: guild.id, channelId, ownerId, requestedBy: actorId },
    guild,
  );
}
