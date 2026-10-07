import { PermissionFlagsBits as P, type Guild, type GuildMember, type Role } from "discord.js";

export const RULE_ROLE_NAME = "Rules ✓";
export const RULE_ROLE_COLOR = 0x57f287;
export const RULE_ROLE_PERMISSIONS = 0n;

export function assertSafeRuleRole(role: Role, everyone: Role, bot: GuildMember) {
  if (
    role.id === everyone.id ||
    role.managed ||
    !role.editable ||
    bot.roles.highest.comparePositionTo(role) <= 0
  ) {
    throw new Error(
      "Choose an unmanaged acceptance role below the bot's highest role, not @everyone.",
    );
  }
  if (role.permissions.bitfield !== RULE_ROLE_PERMISSIONS) {
    throw new Error("Choose an acceptance role without permissions.");
  }
}

export async function prepareRuleRole(
  guild: Guild,
  member: GuildMember,
  bot: GuildMember,
  roleId?: string,
) {
  if (!member.permissions.has(P.ManageRoles)) {
    throw new Error("You need Manage Roles to configure the acceptance role.");
  }
  if (!bot.permissions.has(P.ManageRoles)) {
    throw new Error("The bot needs Manage Roles to create and assign the acceptance role.");
  }
  const everyone = await guild.roles.fetch(guild.id, { force: true });
  if (!everyone) throw new Error("Could not fetch the server's @everyone role.");
  const existing = roleId ? await guild.roles.fetch(roleId, { force: true }) : null;
  if (roleId && !existing) throw new Error("The selected acceptance role no longer exists.");
  if (existing) {
    assertSafeRuleRole(existing, everyone, bot);
    if (member.id !== guild.ownerId && member.roles.highest.comparePositionTo(existing) <= 0) {
      throw new Error("The acceptance role must be below your highest role.");
    }
  }
  return { existing, everyone };
}
