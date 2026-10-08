import { MessageFlags, PermissionFlagsBits as P } from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import { UserFacingError } from "@/core/errors.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
import { assertSafeRuleRole } from "./rule-role.ts";

const PREFIX = "rule-accept:";
export const ruleAcceptanceCustomId = (guildId: string, roleId: string) =>
  `${PREFIX}${guildId}:${roleId}`;

export const ruleAcceptanceHandler = {
  matches: (customId) => customId.startsWith(PREFIX),
  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.inGuild() || !interaction.guild) {
      throw new UserFacingError("Accept the rules in a server.");
    }
    const match = /^rule-accept:(\d+):(\d+)$/.exec(interaction.customId);
    if (
      !match ||
      match[1] !== interaction.guild.id ||
      interaction.message.author.id !== interaction.client.user?.id
    ) {
      throw new UserFacingError(
        "This button is unavailable. Ask a moderator to republish the rules.",
      );
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    const [member, bot, role, everyone] = await Promise.all([
      guild.members.fetch(interaction.user.id),
      guild.members.fetchMe(),
      guild.roles.fetch(match[2]!, { force: true }),
      guild.roles.fetch(guild.id, { force: true }),
    ]);
    if (!role || !everyone)
      throw new UserFacingError(
        "The acceptance role no longer exists. Ask a moderator to republish the rules.",
      );
    if (!bot.permissions.has(P.ManageRoles))
      throw new UserFacingError("The bot needs Manage Roles to assign the acceptance role.");
    assertSafeRuleRole(role, everyone, bot);
    const alreadyAccepted = member.roles.cache.has(role.id);
    if (!alreadyAccepted) await member.roles.add(role, "Accepted the server rules");
    await editSuccessReply(interaction, {
      content: alreadyAccepted ? "You have already accepted the rules." : "Rules accepted.",
      allowedMentions: { parse: [] },
    });
  },
} satisfies ComponentHandler;
