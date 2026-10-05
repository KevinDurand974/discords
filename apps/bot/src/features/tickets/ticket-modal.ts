import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import {
  createTicket,
  TICKET_DESCRIPTION_LIMIT,
  TICKET_TITLE_LIMIT,
  validateTicket,
} from "./ticket-service.ts";

const TICKET_MODAL_PREFIX = "ticket:create:";

export function createTicketModal(userId: string) {
  return new ModalBuilder()
    .setCustomId(`${TICKET_MODAL_PREFIX}${userId}`)
    .setTitle("Open a moderation ticket")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Title")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("title")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(TICKET_TITLE_LIMIT),
        ),
      new LabelBuilder()
        .setLabel("Description")
        .setDescription(
          "Describe your request. Only you, moderators, and administrators can read it.",
        )
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("description")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(TICKET_DESCRIPTION_LIMIT),
        ),
    );
}

export const ticketComponentHandler = {
  matches: (customId) => customId.startsWith(TICKET_MODAL_PREFIX),
  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.inGuild() || !interaction.guild) {
      throw new Error("Tickets can only be opened in a server.");
    }
    if (interaction.customId !== `${TICKET_MODAL_PREFIX}${interaction.user.id}`) {
      throw new Error(
        "This ticket form belongs to another user. Run /ticket to open your own form.",
      );
    }
    const details = validateTicket(
      interaction.fields.getTextInputValue("title"),
      interaction.fields.getTextInputValue("description"),
    );
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await createTicket(interaction.guild, interaction.user, details);
    await interaction.editReply(`Your private ticket is ready: <#${channel.id}>.`);
    setTimeout(() => {
      // Best-effort cleanup: the confirmation may already have been dismissed or deleted.
      void interaction.deleteReply().catch(() => {});
    }, 5_000).unref();
  },
} satisfies ComponentHandler;
