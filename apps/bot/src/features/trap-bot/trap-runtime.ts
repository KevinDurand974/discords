import {
  ChannelType,
  DiscordAPIError,
  Events,
  PermissionFlagsBits as P,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type Role,
} from "discord.js";
import type { CommandLogger } from "@/core/command.ts";
import type { TrapStore } from "./trap-repository.ts";
import { hideRulesRoles, RULES_ROLE_NAME, TRAP_REASON } from "./trap-service.ts";

function isExempt(member: GuildMember) {
  return (
    member.id === member.guild.ownerId ||
    member.permissions.has(P.Administrator) ||
    member.roles.cache.some((role) => role.id !== member.guild.id)
  );
}

export function buildTrapRuntime(store: TrapStore, logger: CommandLogger) {
  const pending = new Map<string, Promise<boolean>>();

  async function deleteTrapMessage(message: Message) {
    try {
      await message.delete();
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === 10008) return;
      console.error("[Trap bot] Failed to delete banned account's trap message", error);
    }
  }

  async function banRoleless(message: Message, guild: Guild, channelId: string) {
    const [member, bot] = await Promise.all([
      guild.members.fetch({ user: message.author.id, force: true }),
      guild.members.fetchMe({ force: true }),
    ]);
    if (member.id === bot.id || isExempt(member)) return false;
    if (!bot.permissions.has(P.BanMembers) || !member.bannable) {
      throw new Error(
        `Cannot ban roleless account ${member.id} in trap ${channelId}; check Ban Members and role hierarchy.`,
      );
    }
    if ((await store.getChannel(guild.id)) !== channelId) return false;
    await message.author
      .send({
        content: `You triggered the bot trap in ${guild.name}. Posting there without a server role results in an automatic ban.\nReason: ${TRAP_REASON}.\nIf this was a mistake, contact the server's moderation team to appeal.`,
        allowedMentions: { parse: [] },
      })
      .catch((error: unknown) =>
        console.warn("[Trap bot] Could not send ban explanation by DM", error),
      );
    const refreshed = await member.fetch(true);
    if (isExempt(refreshed) || !refreshed.bannable) return false;
    if ((await store.getChannel(guild.id)) !== channelId) return false;
    await refreshed.ban({ reason: TRAP_REASON, deleteMessageSeconds: 0 });
    console.info(
      `[Trap bot] Banned ${member.id} in server ${guild.id} after posting in ${channelId}.`,
    );
    await logger
      .log({
        guildId: guild.id,
        command: `/trap auto-ban (${channelId})`,
        userId: member.id,
        userTag: message.author.tag,
        status: "success",
      })
      .catch((error: unknown) => console.error("[Trap bot] Failed to log automatic ban", error));
    return true;
  }

  async function handleMessage(message: Message) {
    const guild = message.guild;
    if (
      !guild ||
      message.webhookId ||
      message.system ||
      message.author.id === message.client.user?.id
    )
      return;
    const channelId = message.channel.isThread() ? message.channel.parentId : message.channelId;
    const key = `${guild.id}:${message.author.id}`;
    if (!channelId) return;
    let claimed = false;
    try {
      if ((await store.getChannel(guild.id)) !== channelId) return;
      let action = pending.get(key);
      if (!action) {
        action = banRoleless(message, guild, channelId).catch((error: unknown) => {
          if (!(error instanceof DiscordAPIError && error.code === 10007))
            console.error(`[Trap bot] Failed to process message in server ${guild.id}`, error);
          return false;
        });
        pending.set(key, action);
        claimed = true;
      }
      if (await action) await deleteTrapMessage(message);
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === 10007) return;
      console.error(`[Trap bot] Failed to process message in server ${guild.id}`, error);
    } finally {
      if (claimed) pending.delete(key);
    }
  }

  async function reconcileGuild(guild: Guild) {
    const channelId = await store.getChannel(guild.id);
    if (!channelId) return;
    const channel = await guild.channels
      .fetch(channelId, { force: true })
      .catch((error: unknown) => {
        if (error instanceof DiscordAPIError && error.code === 10003) return null;
        throw error;
      });
    if (!channel) {
      await store.clearChannel(guild.id, channelId);
      return;
    }
    if (channel.type === ChannelType.GuildText) {
      const bot = await guild.members.fetchMe({ force: true });
      await channel.permissionOverwrites.edit(
        bot.id,
        { ManageMessages: true },
        { reason: "Allow deletion of banned accounts' trap messages" },
      );
      await hideRulesRoles(guild, channel);
    }
  }

  async function handleRulesRole(role: Role) {
    if (role.name !== RULES_ROLE_NAME) return;
    await reconcileGuild(role.guild);
  }

  return { handleMessage, reconcileGuild, handleRulesRole };
}

export function registerTrapRuntime(client: Client, store: TrapStore, logger: CommandLogger) {
  const runtime = buildTrapRuntime(store, logger);
  const report = (error: unknown) =>
    console.error("[Trap bot] Failed to update trap channel configuration", error);
  client.on(Events.MessageCreate, (message) => {
    void runtime.handleMessage(message);
  });
  client.on(Events.GuildRoleCreate, (role) => {
    void runtime.handleRulesRole(role).catch(report);
  });
  client.on(Events.GuildRoleUpdate, (_oldRole, role) => {
    void runtime.handleRulesRole(role).catch(report);
  });
  client.on(Events.ChannelDelete, (channel) => {
    if ("guild" in channel) void store.clearChannel(channel.guild.id, channel.id).catch(report);
  });
  client.once(Events.ClientReady, (readyClient) => {
    void store
      .list()
      .then((traps) =>
        traps.reduce(async (previous, trap) => {
          await previous;
          const guild = readyClient.guilds.cache.get(trap.guildId);
          if (guild) await runtime.reconcileGuild(guild).catch(report);
        }, Promise.resolve()),
      )
      .catch(report);
  });
}
