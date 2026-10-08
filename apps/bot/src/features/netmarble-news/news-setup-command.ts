import { UserFacingError } from "@/core/errors.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
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
        .addIntegerOption((option) =>
          option
            .setName("backfill-count")
            .setDescription("Articles to import, plus at most one pinned post (0–10; default: 10)")
            .setMinValue(0)
            .setMaxValue(10),
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
        throw new UserFacingError("Enable Community for this server before creating a Forum.");
      }
      const bot = await guild.members.fetchMe();
      if (!bot.permissions.has(REQUIRED_BOT_PERMISSIONS)) {
        throw new UserFacingError(
          "The bot needs Manage Channels, Manage Roles, Manage Threads, Send Messages, Send Messages in Threads, Embed Links, Attach Files, Read Message History, and Mention Everyone permissions.",
        );
      }
      if (bot.roles.highest.comparePositionTo(guild.roles.everyone) <= 0) {
        throw new UserFacingError(
          "Move the bot's role above @everyone to create notification roles.",
        );
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
    throw new UserFacingError("Only a server administrator can clean news resources.");
  const token = interaction.customId.slice(CLEAN_PREFIX.length);
  const pending = pendingCleanups.get(token);
  if (
    !pending ||
    pending.expiresAt < Date.now() ||
    pending.guildId !== interaction.guildId ||
    pending.userId !== interaction.user.id
  )
    throw new UserFacingError(
      "This confirmation expired or belongs to another administrator. Run /sla news clean again.",
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
      content: "Cleanup incomplete. Check bot permissions, then run /sla news clean again.",
      components: [],
    });
    return;
  }
  await editSuccessReply(interaction, {
    content: removed
      ? "News Forum and notification roles removed. News publishing is disabled."
      : "News is not configured. Nothing was deleted.",
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
    throw new UserFacingError("Use this command in a server.");
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    throw new UserFacingError("You need Manage Channels to configure news.");
  }
  const store = createNewsSetupRepository();
  const action = interaction.options.getSubcommand();
  if (action === "status") {
    const setup = await store.get(interaction.guildId);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: setup
        ? `News publishing is **${setup.enabled ? "enabled" : "disabled"}** in <#${setup.forumChannelId}>.${setup.initialImportCompleted ? "" : " First articles are still being published."}`
        : "News is not configured for this server.",
    });
    return;
  }
  if (action === "clean") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
      throw new UserFacingError("Only a server administrator can clean news resources.");
    const setup = await store.get(interaction.guildId);
    if (!setup) {
      await interaction.reply({
        content: "News is not configured; nothing to delete.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
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
      content: `**Permanent deletion**\nDelete <#${setup.forumChannelId}>, all its posts, and these notification roles: ${roleIds.map((id) => `<@&${id}>`).join(", ") || "none"}. News publishing will stop.\nConfirm within 5 minutes or do nothing.`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${CLEAN_PREFIX}${token}`)
            .setLabel("Delete Forum and roles")
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
    const response = {
      content: `Published ${result.published} articles.${result.failures.length ? ` ${result.failures.length} couldn't be published. Check bot permissions, then run /sla news backfill again.` : ""}`,
    };
    if (result.failures.length) {
      console.error("News backfill incomplete", result.failures);
      await interaction.editReply(response);
    } else await editSuccessReply(interaction, response);
    return;
  }
  if (action !== "create") throw new Error("Unknown news setup action.");
  const botId = interaction.client.user?.id;
  if (!botId) throw new Error("The bot user is not available.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const count = interaction.options.getInteger("backfill-count") ?? 10;
  const synchronizer = createNewsRuntime(interaction.client).synchronizer;
  const { setup, result } = await synchronizer.withGuildSetup(interaction.guildId, async () => {
    const updateProgress = async (content: string) => {
      try {
        await interaction.editReply({ content, allowedMentions: { parse: [] } });
      } catch (error) {
        console.error(`Could not update news setup progress in ${interaction.guildId}`, error);
      }
    };
    await updateProgress("Setting up news…");
    const setup = await createNewsSetup(
      createNewsGuildGateway(interaction.guild!, botId, interaction.user.tag),
      store,
      count,
    );
    let lastUpdate = Number.NEGATIVE_INFINITY;
    if (!setup.initialImportCompleted) await updateProgress("Fetching the latest news…");
    const result = setup.initialImportCompleted
      ? null
      : await synchronizer.syncGuild(interaction.guildId!, {
          async onProgress({ completed, total }) {
            const now = Date.now();
            if (completed !== total && now - lastUpdate < 2000) return;
            lastUpdate = now;
            await updateProgress(
              total === 0 ? "Finishing news setup…" : `Publishing articles: ${completed}/${total}.`,
            );
          },
        });
    return { setup, result };
  });
  const response = {
    content: `News Forum ready: <#${setup.forumChannelId}>.${result ? ` Published ${result.published} articles.` : ""}${result?.failures.length ? ` ${result.failures.length} couldn't be published. Check bot permissions, then run /sla news backfill again.` : ""}`,
    allowedMentions: { parse: [] as const },
  };
  if (result?.failures.length) {
    console.error("News setup publication incomplete", result.failures);
    await interaction.editReply(response);
  } else await editSuccessReply(interaction, response);
}
