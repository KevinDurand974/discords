import {
  ChannelType,
  GuildFeature,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Guild,
  type SlashCommandSubcommandGroupBuilder,
} from "discord.js";
import { createNewsSetupRepository } from "./news-setup-repository.ts";
import {
  createNewsSetup,
  disableNewsSetup,
  NEWS_FORUM_NAME,
  NEWS_TAGS,
  type NewsGuildGateway,
  type NewsSetup,
} from "./news-setup.ts";

export function configureNewsGroup(group: SlashCommandSubcommandGroupBuilder) {
  return group
    .setName("news")
    .setDescription("Configure Netmarble news")
    .addSubcommand((subcommand) =>
      subcommand.setName("create").setDescription("Create or reactivate the news Forum"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show news Forum configuration"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("disable").setDescription("Stop future news publication"),
    );
}

export function newsForumPermissions(guildId: string, botId: string) {
  return [
    {
      id: guildId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.EmbedLinks,
      ],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
      ],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.MentionEveryone,
      ],
    },
  ];
}

const REQUIRED_BOT_PERMISSIONS = [
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.MentionEveryone,
];

export function createNewsGuildGateway(
  guild: Guild,
  botId: string,
  actorTag: string,
): NewsGuildGateway {
  return {
    guildId: guild.id,
    async preflight() {
      if (!guild.features.includes(GuildFeature.Community)) {
        throw new Error("Forum Channels require a Community server.");
      }
      const bot = await guild.members.fetchMe();
      if (!bot.permissions.has(REQUIRED_BOT_PERMISSIONS)) {
        throw new Error(
          "The bot needs Manage Channels, Manage Roles, Manage Threads, Send Messages, Send Messages in Threads, Embed Links, Attach Files, Read Message History, and Mention Everyone permissions.",
        );
      }
      if (bot.roles.highest.comparePositionTo(guild.roles.everyone) <= 0) {
        throw new Error("The bot role must be above @everyone to create notification roles.");
      }
    },
    async resourcesExist(setup: NewsSetup) {
      const channel = await guild.channels.fetch(setup.forumChannelId);
      if (channel?.type !== ChannelType.GuildForum || setup.mappings.length !== NEWS_TAGS.length)
        return false;
      if (
        !setup.mappings.every(
          ({ menuSeq, tagId }) =>
            NEWS_TAGS.some((category) => category.menuSeq === menuSeq) &&
            channel.availableTags.some((tag) => tag.id === tagId),
        )
      )
        return false;
      const roles = await Promise.all(
        setup.mappings.map(({ notificationRoleId }) => guild.roles.fetch(notificationRoleId)),
      );
      return roles.every(Boolean);
    },
    async createRole(name) {
      const role = await guild.roles.create({
        name,
        mentionable: false,
        permissions: [],
        reason: `News Forum setup by ${actorTag}`,
      });
      return role.id;
    },
    async deleteRole(id) {
      const role = await guild.roles.fetch(id);
      if (role) await role.delete("Rolling back incomplete news Forum setup");
    },
    async createForum(tagNames) {
      const channel = await guild.channels.create({
        name: NEWS_FORUM_NAME,
        type: ChannelType.GuildForum,
        availableTags: tagNames.map((name) => ({ name })),
        permissionOverwrites: newsForumPermissions(guild.id, botId),
        reason: `News Forum setup by ${actorTag}`,
      });
      return { id: channel.id, tags: channel.availableTags.map(({ id, name }) => ({ id, name })) };
    },
    async deleteForum(id) {
      const channel = await guild.channels.fetch(id);
      if (channel) await channel.delete("Rolling back incomplete news Forum setup");
    },
  };
}

export async function handleNewsSetup(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) {
    throw new Error("This command can only be used in a server.");
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("You need the Manage Channels permission to configure news.");
  }
  const store = createNewsSetupRepository();
  const action = interaction.options.getSubcommand();
  if (action === "status") {
    const setup = await store.get(interaction.guildId);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: setup
        ? `News is **${setup.enabled ? "enabled" : "disabled"}** in <#${setup.forumChannelId}>.\n${setup.mappings
            .map(
              ({ menuSeq, tagId, notificationRoleId }) =>
                `${NEWS_TAGS.find((tag) => tag.menuSeq === menuSeq)?.name ?? menuSeq}: tag ${tagId}, <@&${notificationRoleId}>`,
            )
            .join("\n")}`
        : "News is not configured for this server.",
    });
    return;
  }
  if (action === "disable") {
    await disableNewsSetup(interaction.guildId, store);
    await interaction.reply({
      content: "News publishing is disabled. The Forum and roles remain available.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (action !== "create") throw new Error("Unknown news setup action.");
  const botId = interaction.client.user?.id;
  if (!botId) throw new Error("The bot user is not available.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const setup = await createNewsSetup(
    createNewsGuildGateway(interaction.guild, botId, interaction.user.tag),
    store,
  );
  await interaction.editReply({
    content: `News Forum ready: <#${setup.forumChannelId}>.\n${setup.mappings
      .map(
        ({ menuSeq, notificationRoleId }) =>
          `${NEWS_TAGS.find((tag) => tag.menuSeq === menuSeq)?.name ?? menuSeq}: <@&${notificationRoleId}>`,
      )
      .join("\n")}\nArticles are not published until Phase 4.`,
  });
}
