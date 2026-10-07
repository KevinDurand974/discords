import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { changeMemberRole } from "./change-member-role.ts";

export const stripRoleCommand = {
  helpDescription: [
    "Removes the required role from the required server member. Both you and the bot need Manage Roles; ordinary members cannot use this command. Confirmation is private.",
    "The role must be unmanaged, not @everyone, and below the bot's and your highest roles (your hierarchy restriction is waived for the server owner). Roles with permissions are supported. If the member does not have the role, nothing changes.",
    "Example: `/strip-role role:@Gamers user:@Member`",
  ],
  data: new SlashCommandBuilder()
    .setName("strip-role")
    .setDescription("Remove a role from a server member")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(P.ManageRoles)
    .addRoleOption((option) =>
      option.setName("role").setDescription("Role to remove").setRequired(true),
    )
    .addUserOption((option) =>
      option.setName("user").setDescription("Member losing the role").setRequired(true),
    ),
  async execute(interaction) {
    await changeMemberRole(interaction, "strip");
  },
} satisfies CommandDefinition;
