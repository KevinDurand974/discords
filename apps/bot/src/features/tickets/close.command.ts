import { InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { closeTicket } from "./close-ticket.ts";
import { UserFacingError } from "@/core/errors.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";

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
      throw new UserFacingError("Use this command in a server.");
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const closure = await closeTicket(
      interaction.guild,
      interaction.channelId,
      interaction.user.id,
    );
    await editSuccessReply(interaction, {
      content: `Ticket closing <t:${Math.floor(closure.deleteAt.getTime() / 1000)}:R>. Use the channel notice to close now or reopen.`,
      allowedMentions: { parse: [] },
    });
  },
} satisfies CommandDefinition;
