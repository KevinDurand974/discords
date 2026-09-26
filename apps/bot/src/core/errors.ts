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

export const replyWithError = async (interaction: ReplyableInteraction, error: unknown) => {
  const data: InteractionReplyOptions = {
    content:
      error instanceof Error
        ? error.message
        : "There was an error while executing this interaction.",
    flags: MessageFlags.Ephemeral,
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(data);
    return;
  }

  await interaction.reply(data);
};
