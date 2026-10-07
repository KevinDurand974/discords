import {
  Events,
  PermissionFlagsBits as P,
  type Client,
  type MessageReaction,
  type PartialMessageReaction,
  type User,
  type PartialUser,
} from "discord.js";
import { assertSafeReactionRole, emojiKey } from "./reaction-role-model.ts";
import type { ReactionRoleStore } from "./reaction-role-repository.ts";

export function createReactionRoleRuntime(store: ReactionRoleStore) {
  const queues = new Map<string, Promise<void>>();
  const activeClicks = new Set<string>();
  return async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
    if (user.bot || user.id === reaction.client.user?.id) return;
    const clickKey = `${reaction.message.id}:${user.id}:${emojiKey(reaction.emoji)}`;
    if (activeClicks.has(clickKey)) return;
    activeClicks.add(clickKey);
    const queueKey = `${reaction.message.guildId}:${user.id}`;
    const task = (queues.get(queueKey) ?? Promise.resolve())
      .then(async () => {
        const settings = await store.get(reaction.message.id);
        if (!settings) return;
        const message = reaction.message.partial
          ? await reaction.message.fetch()
          : reaction.message;
        if (
          message.guildId !== settings.guildId ||
          message.channelId !== settings.channelId ||
          message.author?.id !== reaction.client.user?.id ||
          !message.inGuild()
        )
          return;
        if (user.partial) user = await user.fetch();
        if (user.bot) return;
        const guild = message.guild;
        const bot = await guild.members.fetchMe();
        if (
          !message.channel
            .permissionsFor(bot)
            ?.has([P.ViewChannel, P.ReadMessageHistory, P.ManageMessages])
        ) {
          throw new Error("Missing permissions to reset reaction role clicks.");
        }
        try {
          const mapping = settings.mappings.find((item) => item.key === emojiKey(reaction.emoji));
          if (!mapping) return;
          const [role, member] = await Promise.all([
            guild.roles.fetch(mapping.roleId, { force: true }),
            guild.members.fetch({ user: user.id, force: true }),
          ]);
          if (!role || !bot.permissions.has(P.ManageRoles))
            throw new Error("Reaction role unavailable.");
          assertSafeReactionRole(role, bot);
          if (member.roles.cache.has(role.id))
            await member.roles.remove(role, "Reaction role toggle");
          else await member.roles.add(role, "Reaction role toggle");
        } finally {
          await reaction.users.remove(user.id);
        }
      })
      .catch((error) => {
        console.error("Reaction role click failed", error);
      });
    queues.set(queueKey, task);
    try {
      await task;
    } finally {
      activeClicks.delete(clickKey);
      if (queues.get(queueKey) === task) queues.delete(queueKey);
    }
  };
}

export function registerReactionRoleRuntime(client: Client, store: ReactionRoleStore) {
  client.on(Events.MessageReactionAdd, createReactionRoleRuntime(store));
}
