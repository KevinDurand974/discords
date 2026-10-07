import {
  ChannelType,
  GuildFeature,
  MessageFlags,
  PermissionFlagsBits as P,
  type ModalSubmitInteraction,
  type Role,
} from "discord.js";
import { createRuleComponents } from "./rule-components.ts";
import { clearRuleChannel } from "./clear-rule-channel.ts";
import type { RuleForm } from "./rule-form.ts";
import {
  prepareRuleRole,
  assertSafeRuleRole,
  RULE_ROLE_NAME,
  RULE_ROLE_COLOR,
  RULE_ROLE_PERMISSIONS,
} from "./rule-role.ts";

export async function publishRules(interaction: ModalSubmitInteraction, form: RuleForm) {
  const guild = interaction.guild!;
  const { rules, name, channelId: selected } = form;
  createRuleComponents(rules, { guildId: guild.id, roleId: form.roleId ?? "pending" });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [member, bot] = await Promise.all([
    guild.members.fetch(interaction.user.id),
    guild.members.fetchMe(),
  ]);
  if (!member.permissions.has(P.ManageChannels)) {
    throw new Error("You need Manage Channels to publish rules.");
  }
  if (!selected && !bot.permissions.has(P.ManageChannels)) {
    throw new Error("The bot needs Manage Channels to create a rules channel.");
  }
  const isCommunity = !selected && (await guild.fetch()).features.includes(GuildFeature.Community);
  if (isCommunity && !member.permissions.has(P.ManageGuild)) {
    throw new Error("You need Manage Server to designate the Community Rules Channel.");
  }
  if (isCommunity && !bot.permissions.has(P.ManageGuild)) {
    throw new Error("The bot needs Manage Server to designate the Community Rules Channel.");
  }
  const { existing, everyone } = await prepareRuleRole(guild, member, bot, form.roleId);
  const channel = selected
    ? await guild.channels.fetch(selected, { force: true })
    : await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        permissionOverwrites: [{ id: bot.id, allow: [P.ViewChannel, P.SendMessages] }],
        reason: `Rules channel created by ${interaction.user.tag}`,
      });
  if (!channel || channel.guildId !== guild.id || channel.type !== ChannelType.GuildText) {
    throw new Error("Choose an existing text channel in this server.");
  }
  let createdRole: Role | undefined;
  try {
    if (selected && !channel.permissionsFor(member)?.has([P.ViewChannel, P.SendMessages])) {
      throw new Error("You need View Channel and Send Messages in the destination.");
    }
    if (!channel.permissionsFor(bot)?.has([P.ViewChannel, P.SendMessages])) {
      throw new Error("The bot needs View Channel and Send Messages in the destination.");
    }
    if (selected) {
      const deletionPermissions = [P.ManageMessages, P.ReadMessageHistory];
      if (!channel.permissionsFor(member)?.has(deletionPermissions)) {
        throw new Error(
          "You need Manage Messages and Read Message History to replace existing rules.",
        );
      }
      if (!channel.permissionsFor(bot)?.has(deletionPermissions)) {
        throw new Error(
          "The bot needs Manage Messages and Read Message History to replace existing rules.",
        );
      }
    }
    const role =
      existing ??
      (createdRole = await guild.roles.create({
        name: RULE_ROLE_NAME,
        colors: { primaryColor: RULE_ROLE_COLOR },
        permissions: RULE_ROLE_PERMISSIONS,
        hoist: false,
        mentionable: false,
        reason: `Rules acceptance role created by ${interaction.user.tag}`,
      }));
    assertSafeRuleRole(role, everyone, bot);
    const components = createRuleComponents(rules, { guildId: guild.id, roleId: role.id });
    if (selected) {
      await clearRuleChannel(channel).catch((error: unknown) => {
        throw new Error(
          "Could not clear the channel. Some messages may already have been permanently deleted; new rules were not published.",
          { cause: error },
        );
      });
    }
    await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components,
      allowedMentions: { parse: [] },
    });
    if (isCommunity) {
      await guild.edit({
        rulesChannel: channel.id,
        reason: `Community Rules Channel configured by ${interaction.user.tag}`,
      });
    }
  } catch (error) {
    if (createdRole) {
      await createdRole.delete("Rules publication failed").catch((cleanupError: unknown) => {
        console.error("Failed to delete incomplete rules acceptance role", cleanupError);
      });
    }
    if (!selected) {
      await channel.delete("Rules publication failed").catch((cleanupError: unknown) => {
        console.error("Failed to delete incomplete rules channel", cleanupError);
      });
    }
    throw error;
  }
  await interaction.editReply({
    content: `Server rules published in <#${channel.id}>.`,
    allowedMentions: { parse: [] },
  });
}
