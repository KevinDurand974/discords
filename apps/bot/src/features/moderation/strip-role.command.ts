import { InteractionContextType, PermissionFlagsBits as P, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { changeMemberRole } from "./change-member-role.ts";

export const stripRoleCommand = {
  helpDescription: [
    "Removes the required role from the required server member. Both you and the bot need Manage Roles; ordinary members cannot use this command. Confirmation is private.",
    "The role must be unmanaged, not @everyone, and below the bot's and your highest roles (your hierarchy restriction is waived for the server owner). Roles with permissions are supported. If the member does not have the role, nothing changes.",
    "Select the member first, then search their removable roles by name. Up to 25 matching roles are shown.",
    "Example: `/strip-role user:@Member role:Gamers`",
  ],
  data: new SlashCommandBuilder()
    .setName("strip-role")
    .setDescription("Remove a role from a server member")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(P.ManageRoles)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member losing the role").setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("role")
        .setDescription("Search this member's roles to remove")
        .setRequired(true)
        .setAutocomplete(true),
    ),
  async autocomplete(interaction) {
    const guild = interaction.guild;
    const userId = interaction.options.get("user")?.value;
    if (
      !guild ||
      typeof userId !== "string" ||
      interaction.options.getFocused(true).name !== "role"
    ) {
      await interaction.respond([]);
      return;
    }
    try {
      const [actor, bot, target] = await Promise.all([
        guild.members.fetch({ user: interaction.user.id, force: true }),
        guild.members.fetchMe({ force: true }),
        guild.members.fetch({ user: userId, force: true }),
      ]);
      if (!actor.permissions.has(P.ManageRoles) || !bot.permissions.has(P.ManageRoles)) {
        await interaction.respond([]);
        return;
      }
      const query = String(interaction.options.getFocused()).trim().toLowerCase();
      const choices = target.roles.cache
        .filter(
          (role) =>
            role.id !== guild.id &&
            !role.managed &&
            role.editable &&
            bot.roles.highest.comparePositionTo(role) > 0 &&
            (actor.id === guild.ownerId || actor.roles.highest.comparePositionTo(role) > 0) &&
            (role.name.toLowerCase().includes(query) || role.id.includes(query)),
        )
        .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id))
        .map((role) => ({
          name: `${role.name.slice(0, 75)} (${role.id})`.slice(0, 100),
          value: role.id,
        }))
        .slice(0, 25);
      await interaction.respond(choices);
    } catch (error) {
      console.error("Strip-role autocomplete failed", error);
      if (!interaction.responded) await interaction.respond([]);
    }
  },
  async execute(interaction) {
    await changeMemberRole(interaction, "strip");
  },
} satisfies CommandDefinition;
