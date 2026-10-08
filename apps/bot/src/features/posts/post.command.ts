import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { UserFacingError } from "@/core/errors.ts";
import { createPostModal } from "./post-modal.ts";

export const postHelpDescription = [
  "Opens a form with a title (1–100 characters), multiline post content and a destination channel, defaulting to the current channel when supported. The rendered title and content together must fit 4000 characters.",
  "Publishes a Components V2 container. Each --- becomes a native separator, up to 19; additional delimiters remain text so nothing is lost. Mentions are suppressed. Cancelling publishes nothing.",
  "Both you and the bot need View Channel and Send Messages in the destination, or Send Messages in Threads for an active unlocked thread. Private threads require membership or Manage Threads. The private confirmation disappears after 10 seconds; the post remains.",
  "Example: `/post`",
] as const;

export const postCommand = {
  helpDescription: postHelpDescription,
  data: new SlashCommandBuilder()
    .setName("post")
    .setDescription("Create a formatted post in a channel")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(null),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new UserFacingError("Use this command in a server.");
    }
    await interaction.showModal(createPostModal(interaction));
  },
} satisfies CommandDefinition;
