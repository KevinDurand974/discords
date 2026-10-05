import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { closeTicket } from "./close-ticket.ts";
import { ticketClosureMessage } from "./ticket-closure-components.ts";

export const closeCommand = {
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
