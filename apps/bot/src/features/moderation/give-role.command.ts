import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { giveRole } from "./give-role.ts";

export const giveRoleCommand = {
  helpDescription: [
    "Assigns the required role to the required server member. Roles may have permissions. Both you and the bot need Manage Roles; ordinary members cannot use this command. Confirmation is private.",
    "The role must be unmanaged, not @everyone, and below the bot's and your highest roles (your hierarchy restriction is waived for the server owner). An already-assigned role is left unchanged.",
    "Example: `/give-role role:@Gamers user:@Member`",
  ],
  data: new SlashCommandBuilder()
    .setName("give-role")
    .setDescription("Assign a role to a server member")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(P.ManageRoles)
    .addRoleOption((option) =>
      option.setName("role").setDescription("Role to assign").setRequired(true),
    )
    .addUserOption((option) =>
      option.setName("user").setDescription("Member receiving the role").setRequired(true),
    ),
  async execute(interaction) {
    await giveRole(interaction);
  },
} satisfies CommandDefinition;
