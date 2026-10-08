import {
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits as P,
  type ChatInputCommandInteraction,
} from "discord.js";

import { UserFacingError } from "@/core/errors.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";

export async function unbanUser(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guild)
    throw new UserFacingError("Use this command in a server.");
  const userId = interaction.options.getString("user-id", true).trim();
  if (!/^[1-9]\d{16,19}$/.test(userId) || BigInt(userId) > 18_446_744_073_709_551_615n)
    throw new UserFacingError(
      "Enter a valid Discord user ID (17–20 digits), not a mention or username.",
    );
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  const [member, bot] = await Promise.all([
    guild.members.fetch({ user: interaction.user.id, force: true }),
    guild.members.fetchMe({ force: true }),
  ]);
  if (!member.permissions.has(P.BanMembers))
    throw new UserFacingError("You need Ban Members to unban users.");
  if (!bot.permissions.has(P.BanMembers))
    throw new UserFacingError("The bot needs Ban Members to unban users.");
  try {
    await guild.bans.remove(userId, `Unban requested by ${interaction.user.id}`);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 10026)
      throw new UserFacingError("This user is not banned from this server.");
    throw error;
  }
  await editSuccessReply(interaction, {
    content: `User ${userId} unbanned.`,
    allowedMentions: { parse: [] },
  });
}
