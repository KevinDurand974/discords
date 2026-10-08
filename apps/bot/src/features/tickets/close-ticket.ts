import { UserFacingError } from "@/core/errors.ts";
import { ticketClosureMessage } from "./ticket-closure-components.ts";
import type { Guild } from "discord.js";
import { authorizeTicket, requireTicketDeletionPermission } from "./ticket-access.ts";
import { scheduleTicketClosure } from "./ticket-runtime.ts";

export async function closeTicket(guild: Guild, channelId: string, actorId: string) {
  const { channel, ownerId } = await authorizeTicket(guild, channelId, actorId);
  await requireTicketDeletionPermission(guild, channel);
  const closure = await scheduleTicketClosure(
    { guildId: guild.id, channelId, ownerId, requestedBy: actorId },
    guild,
  );
  try {
    await channel.send(ticketClosureMessage(closure));
  } catch (error) {
    throw new UserFacingError(
      "Ticket closure scheduled, but the notice couldn't be posted. Check bot permissions. Run /close-ticket again for the controls.",
      { cause: error },
    );
  }
  return closure;
}
