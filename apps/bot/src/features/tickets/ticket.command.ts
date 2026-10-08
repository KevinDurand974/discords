import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import type { CommandDefinition } from "@/core/command.ts";
import { createTicketModal } from "./ticket-modal.ts";

export const ticketHelpDescription = [
  "Opens a modal with a title (1–100 characters) and multiline description (1–4000 characters). Creates a private ticket-xxxxx text channel for you, the bot and non-managed moderator roles with Manage Messages; server owners/administrators retain access.",
  "Pins closing instructions and posts your request as Components V2. The bot needs Manage Channels, View Channel, Send Messages, Pin Messages and Read Message History. Your private channel-link confirmation disappears after 10 seconds; the ticket remains. Cancelling creates nothing.",
  "Example: `/ticket`",
] as const;

export const ticketCommand = {
  helpDescription: ticketHelpDescription,
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Open a private ticket with the moderators")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(null),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new UserFacingError("Use this command in a server.");
    }
    await interaction.showModal(createTicketModal(interaction.user.id));
  },
} satisfies CommandDefinition;
