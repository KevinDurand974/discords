import {
  MessageFlags,
  PermissionFlagsBits as P,
  type ChatInputCommandInteraction,
} from "discord.js";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";

export async function changeMemberRole(
  interaction: ChatInputCommandInteraction,
  action: "give" | "strip",
) {
  if (!interaction.inGuild() || !interaction.guild)
    throw new Error("Use this command in a server.");
  const roleId = interaction.options.getRole("role", true).id;
  const userId = interaction.options.getUser("user", true).id;
  const verb = action === "give" ? "assign" : "remove";
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  const [actor, bot] = await Promise.all([
    guild.members.fetch({ user: interaction.user.id, force: true }),
    guild.members.fetchMe({ force: true }),
  ]);
  if (!actor.permissions.has(P.ManageRoles))
    throw new Error(`You need Manage Roles to ${verb} roles.`);
  if (!bot.permissions.has(P.ManageRoles))
    throw new Error(`The bot needs Manage Roles to ${verb} roles.`);
  const role = await guild.roles.fetch(roleId, { force: true });
  if (!role) throw new Error("This role no longer exists.");
  if (role.id === guild.id || role.managed)
    throw new Error(`You cannot ${verb} @everyone or a managed role.`);
  if (!role.editable || bot.roles.highest.comparePositionTo(role) <= 0)
    throw new Error(`Move the bot's highest role above the role to ${verb}.`);
  if (actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(role) <= 0)
    throw new Error(`You can only ${verb} roles below your highest role.`);
  const target = await guild.members.fetch({ user: userId, force: true });
  const hasRole = target.roles.cache.has(roleId);
  if (action === "give" && !hasRole)
    await target.roles.add(role, `Role assigned by ${actor.id} via /give-role`);
  if (action === "strip" && hasRole)
    await target.roles.remove(role, `Role removed by ${actor.id} via /strip-role`);
  const content =
    action === "give"
      ? hasRole
        ? `<@${userId}> already has <@&${roleId}>.`
        : `Assigned <@&${roleId}> to <@${userId}>.`
      : hasRole
        ? `Removed <@&${roleId}> from <@${userId}>.`
        : `<@${userId}> does not have <@&${roleId}>.`;
  await editSuccessReply(interaction, { content, allowedMentions: { parse: [] } });
}
