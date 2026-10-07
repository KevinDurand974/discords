import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { unbanUser } from "./unban-user.ts";

export const unbanCommand = {
  helpDescription: [
    "Removes a server ban using the required user-id string (a Discord user ID, not a mention). The user must rejoin through a valid invitation; unbanning does not restore roles or membership. Confirmation is private.",
    "Server only. Both you and the bot need Ban Members, checked again at execution. Works for trap bans and other server bans. If the user is not banned, no change is made.",
    "Example: `/unban user-id:123456789012345678`",
  ],
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user from this server by their Discord user ID")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(P.BanMembers)
    .addStringOption((option) =>
      option
        .setName("user-id")
        .setDescription("Discord user ID of the banned account (17–20 digits)")
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20),
    ),
  async execute(interaction) {
    await unbanUser(interaction);
  },
} satisfies CommandDefinition;
