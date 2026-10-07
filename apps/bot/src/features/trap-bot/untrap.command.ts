import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { getTrapStore } from "./trap-repository.ts";
import { removeTrap } from "./remove-trap.ts";

export const untrapCommand = {
  helpDescription: [
    "Disables the server's bot trap, removes its database setting, and deletes its configured channel if it still exists. Uses the stored channel ID, not the name. Confirmation is private. Does not unban accounts; use /unban separately.",
    "Server only; you need Manage Channels and Ban Members, checked again at execution. The bot needs Manage Channels in the destination to delete it. Missing/deleted channels still have their stored setting removed. If channel deletion fails, monitoring remains disabled and you are told to delete the leftover channel manually.",
    "Example: `/untrap`",
  ],
  data: new SlashCommandBuilder()
    .setName("untrap")
    .setDescription("Disable the bot trap and remove its channel and stored configuration")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(P.ManageChannels | P.BanMembers),
  async execute(interaction) {
    await removeTrap(interaction, getTrapStore());
  },
} satisfies CommandDefinition;
