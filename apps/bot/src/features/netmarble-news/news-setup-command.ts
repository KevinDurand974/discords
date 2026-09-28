import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  GuildFeature,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type SlashCommandSubcommandGroupBuilder,
} from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import { createNewsSetupRepository } from "./news-setup-repository.ts";
import { createNewsRuntime } from "./news-runtime.ts";
import {
  cleanNewsSetup,
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
      subcommand
        .setName("create")
        .setDescription("Create or reactivate the news Forum")
        .addStringOption((option) =>
          option
            .setName("import-mode")
            .setDescription("Import historical news or start with future articles")
            .addChoices(
              { name: "backfill", value: "backfill" },
              { name: "future-only", value: "future_only" },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("backfill-count")
            .setDescription("Newest articles to import (default: 10)")
            .setMinValue(1)
            .setMaxValue(50),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("backfill")
        .setDescription("Import historical articles without notifying roles")
        .addIntegerOption((option) =>
          option
            .setName("count")
            .setDescription("Newest articles to import (default: 10)")
            .setMinValue(1)
            .setMaxValue(50),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show news Forum configuration"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("disable").setDescription("Stop future news publication"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("clean")
        .setDescription("Permanently delete the news Forum, roles and history"),
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

function isMissingDiscordResource(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

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
      let role;
      try {
        role = await guild.roles.fetch(id);
      } catch (error) {
        if (isMissingDiscordResource(error, 10011)) return;
        throw error;
      }
      if (!role) return;
      if (role.id === guild.id || role.managed)
        throw new Error(`Refusing to delete protected role ${id}.`);
      try {
        await role.delete(`News Forum cleanup by ${actorTag}`);
      } catch (error) {
        if (!isMissingDiscordResource(error, 10011)) throw error;
      }
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
      let channel;
      try {
        channel = await guild.channels.fetch(id);
      } catch (error) {
        if (isMissingDiscordResource(error, 10003)) return;
        throw error;
      }
      if (!channel) return;
      if (channel.type !== ChannelType.GuildForum)
        throw new Error(`Saved channel ${id} is not a Forum; refusing to delete it.`);
      try {
        await channel.delete(`News Forum cleanup by ${actorTag}`);
      } catch (error) {
        if (!isMissingDiscordResource(error, 10003)) throw error;
      }
    },
  };
}

const CLEAN_PREFIX = "news:clean:";
const pendingCleanups = new Map<
  string,
  {
    guildId: string;
    userId: string;
    forumId: string;
    roleIds: string[];
    expiresAt: number;
  }
>();

export async function handleNewsCleanConfirmation(interaction: ButtonInteraction) {
  if (
    !interaction.inGuild() ||
    !interaction.guild ||
    !interaction.guildId ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  )
    throw new Error("Only a server administrator can clean news resources.");
  const token = interaction.customId.slice(CLEAN_PREFIX.length);
  const pending = pendingCleanups.get(token);
  if (
    !pending ||
    pending.expiresAt < Date.now() ||
    pending.guildId !== interaction.guildId ||
    pending.userId !== interaction.user.id
  )
    throw new Error(
      "This confirmation expired or belongs to another administrator. Run /setup news clean again.",
    );
  pendingCleanups.delete(token);
  await interaction.deferUpdate();
  let removed: boolean;
  try {
    const botId = interaction.client.user?.id;
    if (!botId) throw new Error("The bot user is not available.");
    removed = await cleanNewsSetup(
      createNewsGuildGateway(interaction.guild, botId, interaction.user.tag),
      createNewsSetupRepository(),
      createNewsRuntime(interaction.client).synchronizer,
      pending.forumId,
      pending.roleIds,
    );
  } catch (error) {
    console.error(`News cleanup failed in ${interaction.guildId}`, error);
    await interaction.editReply({
      content: `Cleanup incomplete: ${error instanceof Error ? error.message : String(error)} Check /setup news status; if still configured, run /setup news clean again to retry.`,
      components: [],
    });
    return;
  }
  await interaction.editReply({
    content: removed
      ? "News Forum, notification roles and this server's publication history were removed. You may run /setup news create again."
      : "News is already unconfigured; nothing was deleted.",
    components: [],
  });
}

export const newsCleanComponentHandler: ComponentHandler = {
  matches: (customId) => customId.startsWith(CLEAN_PREFIX),
  async execute(interaction) {
    if (!interaction.isButton()) return;
    await handleNewsCleanConfirmation(interaction);
  },
};

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
        ? `News is **${setup.enabled ? "enabled" : "disabled"}** in <#${setup.forumChannelId}>. Initial import: ${setup.initialImportCompleted ? "complete" : `pending (${setup.initialImportMode}, ${setup.initialBackfillCount} newest)`}.\n${setup.mappings
            .map(
              ({ menuSeq, tagId, notificationRoleId }) =>
                `${NEWS_TAGS.find((tag) => tag.menuSeq === menuSeq)?.name ?? menuSeq}: tag ${tagId}, <@&${notificationRoleId}>`,
            )
            .join("\n")}`
        : "News is not configured for this server.",
    });
    return;
  }
  if (action === "clean") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
      throw new Error("Only a server administrator can clean news resources.");
    const setup = await store.get(interaction.guildId);
    if (!setup) {
      await interaction.reply({
        content: "News is not configured; nothing to delete.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const count = await store.publicationCount(interaction.guildId);
    const token = randomUUID();
    const roleIds = [
      ...new Set(setup.mappings.map(({ notificationRoleId }) => notificationRoleId)),
    ].sort();
    pendingCleanups.forEach((entry, key) => {
      if (entry.expiresAt < Date.now()) pendingCleanups.delete(key);
    });
    pendingCleanups.set(token, {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      forumId: setup.forumChannelId,
      roleIds,
      expiresAt: Date.now() + 300_000,
    });
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
      content: `**Permanent deletion for this server**\nForum: <#${setup.forumChannelId}> (ID ${setup.forumChannelId}); all posts, comments and attachments.\nNotification roles: ${roleIds.map((id) => `<@&${id}> (ID ${id})`).join(", ") || "none"}; all member assignments.\nPublication history: **${count}** imported-article records for this server.\nGlobal source data and other servers are unaffected. Confirm within 5 minutes or do nothing.`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${CLEAN_PREFIX}${token}`)
            .setLabel("Delete Forum, roles and history")
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });
    return;
  }
  if (action === "disable") {
    await createNewsRuntime(interaction.client).synchronizer.withGuildSetup(
      interaction.guildId,
      () => disableNewsSetup(interaction.guildId!, store),
    );
    await interaction.reply({
      content: "News publishing is disabled. The Forum and roles remain available.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (action === "backfill") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await createNewsRuntime(interaction.client).synchronizer.syncGuild(
      interaction.guildId,
      { mode: "backfill", count: interaction.options.getInteger("count") ?? 10 },
    );
    await interaction.editReply({
      content: `Backfill: ${result.published} published. ${result.failures.length} failed.${result.failures.length ? ` IDs: ${result.failures.join("; ").slice(0, 1000)}` : ""}`,
    });
    return;
  }
  if (action !== "create") throw new Error("Unknown news setup action.");
  const botId = interaction.client.user?.id;
  if (!botId) throw new Error("The bot user is not available.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const mode =
    interaction.options.getString("import-mode") === "future_only" ? "future_only" : "backfill";
  const count = interaction.options.getInteger("backfill-count") ?? 10;
  const synchronizer = createNewsRuntime(interaction.client).synchronizer;
  const { setup, result } = await synchronizer.withGuildSetup(interaction.guildId, async () => {
    const setup = await createNewsSetup(
      createNewsGuildGateway(interaction.guild!, botId, interaction.user.tag),
      store,
      mode,
      count,
    );
    const result = setup.initialImportCompleted
      ? null
      : await synchronizer.syncGuild(interaction.guildId!);
    return { setup, result };
  });
  const summary = result
    ? `Initial import: ${result.published} published, ${result.skipped} skipped, ${result.failures.length} failed.${result.failures.length ? ` IDs: ${result.failures.join("; ").slice(0, 800)}` : ""}`
    : "Already imported; future synchronization remains active.";
  await interaction.editReply({
    content: `News Forum ready: <#${setup.forumChannelId}>.\n${setup.mappings
      .map(
        ({ menuSeq, notificationRoleId }) =>
          `${NEWS_TAGS.find((tag) => tag.menuSeq === menuSeq)?.name ?? menuSeq}: <@&${notificationRoleId}>`,
      )
      .join("\n")}\n${summary}`,
  });
}
