import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import {
  autocompleteYoutubeTag,
  configureYoutubeClean,
  configureYoutubeSetup,
  handleYoutubeSetup,
} from "@/features/youtube-videos/videos.command.ts";
import type { CommandDefinition } from "@/core/command.ts";

export const setupHelpDescription = [
  "youtube: Create or repair the default YouTube forum, without adding a creator. Requires Manage Channels or server ownership.",
  "clean: Administrator/server-owner cleanup with a user-bound confirmation lasting 5 minutes. With tag, scopes cleanup to that creator; without tag, affects all tracked creators. Choose Videos only or Everything in scope. Deletion is permanent; user-owned forums and unrelated content are preserved.",
  "Example: `/setup youtube`. For command-log configuration, use `/logs`.",
] as const;

export const setupCommand = {
  helpDescription: setupHelpDescription,
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure YouTube resources")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(configureYoutubeSetup)
    .addSubcommand(configureYoutubeClean),
  autocomplete: autocompleteYoutubeTag,
  async execute(interaction) {
    await handleYoutubeSetup(interaction);
  },
} satisfies CommandDefinition;
