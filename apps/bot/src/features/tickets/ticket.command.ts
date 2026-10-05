import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { createTicketModal } from "./ticket-modal.ts";

export const ticketCommand = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Open a private ticket with the moderators")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(null),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new Error("Tickets can only be opened in a server.");
    }
    await interaction.showModal(createTicketModal(interaction.user.id));
  },
} satisfies CommandDefinition;
