import {
  ChannelType,
  ContainerBuilder,
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits as P,
  TextDisplayBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import type { TrapStore } from "./trap-repository.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";

export const RULES_ROLE_NAME = "Rules ✓";
export const TRAP_REASON = "Bot trap: posted in the trap channel without any server role";

export function createTrapWarning() {
  return new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# ⚠️ Bot Trap — Do Not Post"),
      new TextDisplayBuilder().setContent(
        "This channel helps filter automated accounts that spam the server by allowing them to post here.\n\n" +
          "**Posting ANY message here without a server role will automatically and immediately BAN your account from this server.** " +
          "This applies to human accounts too, not just bots. The @everyone role does not count.\n\n" +
          "Do not test the trap. Read the server rules instead. Members with **Rules ✓** cannot normally see this channel. " +
          "Members with any other role, the server owner, and administrators are exempt.",
      ),
    );
}

export async function createTrapChannel(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  store: TrapStore,
  channelName = "trap",
) {
  if (!interaction.inGuild() || !interaction.guild)
    throw new UserFacingError("Use this command in a server.");
  const name = channelName.trim().toLowerCase().replace(/\s+/g, "-");
  if (!name || name.length > 100)
    throw new UserFacingError("Channel name must be between 1 and 100 characters.");
  const guild = interaction.guild;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [member, bot] = await Promise.all([
    guild.members.fetch({ user: interaction.user.id, force: true }),
    guild.members.fetchMe({ force: true }),
  ]);
  const permissions = [P.ManageChannels, P.BanMembers];
  if (!member.permissions.has(permissions))
    throw new UserFacingError("You need Manage Channels and Ban Members to configure a bot trap.");
  if (!bot.permissions.has([...permissions, P.ManageRoles]))
    throw new UserFacingError(
      "The bot needs Manage Channels, Ban Members, and Manage Roles to operate a bot trap.",
    );
  const existingId = await store.getChannel(guild.id);
  if (existingId) {
    const existing = await guild.channels
      .fetch(existingId, { force: true })
      .catch((error: unknown) => {
        if (error instanceof DiscordAPIError && error.code === 10003) return null;
        throw error;
      });
    if (existing)
      throw new UserFacingError(
        `A bot trap is already active in <#${existingId}>. Use /untrap or delete that channel before creating another.`,
      );
    await store.clearChannel(guild.id, existingId);
  }
  const roles = await guild.roles.fetch();
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    topic:
      "WARNING: posting here without a role results in an immediate automatic ban. Do not test this channel.",
    permissionOverwrites: [
      {
        id: guild.id,
        allow: [P.ViewChannel, P.ReadMessageHistory],
        deny: [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads],
      },
      {
        id: bot.id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages],
      },
      ...roles
        .filter((role) => role.name === RULES_ROLE_NAME && role.id !== guild.id)
        .map((role) => ({ id: role.id, deny: [P.ViewChannel] })),
    ],
    reason: `Bot trap configured by ${interaction.user.tag}`,
  });
  try {
    await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [createTrapWarning()],
      allowedMentions: { parse: [] },
    });
    if (!(await store.activate(guild.id, channel.id))) {
      throw new UserFacingError(
        "A bot trap is already configured. Use /untrap before creating another.",
      );
    }
    await channel.permissionOverwrites.edit(
      guild.id,
      { SendMessages: true },
      { reason: "Bot trap warning published and monitoring activated" },
    );
  } catch (error) {
    await store
      .clearChannel(guild.id, channel.id)
      .catch((cleanupError: unknown) =>
        console.error("[Trap bot] Failed to clear incomplete trap configuration", cleanupError),
      );
    await channel
      .delete("Bot trap setup failed")
      .catch((cleanupError: unknown) =>
        console.error("[Trap bot] Failed to delete incomplete trap channel", cleanupError),
      );
    throw error;
  }
  await editSuccessReply(interaction, {
    content: `Bot trap active in <#${channel.id}>. **Accounts without a role will be banned immediately if they post there.** Use /untrap to disable the trap.`,
    allowedMentions: { parse: [] },
  });
}

export async function hideRulesRoles(guild: Guild, channel: TextChannel) {
  const roles = await guild.roles.fetch();
  await roles
    .filter((role) => role.name === RULES_ROLE_NAME && role.id !== guild.id)
    .reduce(async (previous, role) => {
      await previous;
      await channel.permissionOverwrites.edit(
        role.id,
        { ViewChannel: false },
        { reason: "Hide bot trap from members who accepted the rules" },
      );
    }, Promise.resolve());
}
