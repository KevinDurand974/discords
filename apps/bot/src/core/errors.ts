import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type ModalSubmitInteraction,
} from "discord.js";

type ReplyableInteraction =
  | ButtonInteraction
  | ChatInputCommandInteraction
  | ModalSubmitInteraction;

export class UserFacingError extends Error {}

export const replyWithError = async (interaction: ReplyableInteraction, error: unknown) => {
  console.error("Interaction failed", error);
  const data: InteractionReplyOptions = {
    content:
      error instanceof UserFacingError
        ? error.message
        : "Couldn't complete this action. Please try again. If it keeps failing, contact a server administrator.",
    flags: MessageFlags.Ephemeral,
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(data);
    return;
  }

  await interaction.reply(data);
};
