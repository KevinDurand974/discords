import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { closeTicket } from "./close-ticket.ts";
import { ticketClosureMessage } from "./ticket-closure-components.ts";

export const closeTicketHelpDescription = [
  "Run inside a ticket channel to schedule permanent deletion in 5 minutes, without a transcript or extra confirmation. Only the requester, ticket moderators, administrators or server owner can close it. The bot needs Manage Channels.",
  "The public notice offers Close now and Reopen. Reopen cancels deletion; Close now deletes immediately. Deadlines survive restarts; worker downtime or rate limits may delay deletion. Commands outside a valid ticket are rejected. Deletion is irreversible.",
  "Example: `/close-ticket`",
] as const;

export const closeCommand = {
  helpDescription: closeTicketHelpDescription,
  data: new SlashCommandBuilder()
    .setName("close-ticket")
    .setDescription("Schedule permanent deletion of this ticket in 5 minutes")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(null),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new Error("Tickets can only be closed in a server.");
    }
    await interaction.deferReply();
    const closure = await closeTicket(
      interaction.guild,
      interaction.channelId,
      interaction.user.id,
    );
    await interaction.editReply(ticketClosureMessage(closure));
  },
} satisfies CommandDefinition;
