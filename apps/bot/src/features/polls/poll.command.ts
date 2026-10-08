import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import type { CommandDefinition } from "@/core/command.ts";
import { createPollModal } from "./poll-modal.ts";

export const pollHelpDescription = [
  "Opens a modal for a native Discord poll: question up to 300 characters, 2–10 distinct answers (one per line, up to 55 characters each), duration from 1 to 768 hours (default 24), single/multiple choice and destination channel.",
  "Publishes in a server text/announcement channel or an active unlocked thread. Both you and the bot need View Channel, Send Polls and Send Messages (Send Messages in Threads for threads). Private threads require membership or Manage Threads. Cancelling the modal publishes nothing; Discord handles voting and expiry.",
  "Example: `/poll`",
] as const;

export const pollCommand = {
  helpDescription: pollHelpDescription,
  data: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Open a form to create a native Discord poll")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(null),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new UserFacingError("Use this command in a server.");
    }
    await interaction.showModal(createPollModal(interaction));
  },
} satisfies CommandDefinition;
