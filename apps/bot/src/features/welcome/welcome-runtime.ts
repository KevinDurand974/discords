import {
  ChannelType,
  Events,
  MessageFlags,
  escapeMarkdown,
  type Client,
  type GuildMember,
  type PartialGuildMember,
} from "discord.js";
import type { WelcomeStore } from "./welcome-repository.ts";
import { createWelcomeMessageContainer } from "./welcome-messages.ts";

export function renderWelcomeMessage(
  template: string,
  member: GuildMember | PartialGuildMember,
  arrival: boolean,
) {
  const user = arrival ? `<@${member.id}>` : escapeMarkdown(member.user?.username ?? member.id);
  return template
    .replace(/\{user\}|\{server\}|\{memberCount\}/g, (placeholder) => {
      if (placeholder === "{user}") return user;
      if (placeholder === "{memberCount}") return String(member.guild.memberCount);
      return escapeMarkdown(member.guild.name);
    })
    .slice(0, 2000);
}

export async function sendWelcomeMessage(
  member: GuildMember | PartialGuildMember,
  arrival: boolean,
  store: WelcomeStore,
) {
  try {
    const settings = await store.get(member.guild.id);
    if (!settings) return;
    const channel = await member.guild.channels.fetch(settings.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        createWelcomeMessageContainer(
          renderWelcomeMessage(
            arrival ? settings.arrivalMessage : settings.departureMessage,
            member,
            arrival,
          ),
          arrival,
        ),
      ],
      allowedMentions: { parse: [], users: arrival ? [member.id] : [] },
    });
  } catch (error) {
    console.error(
      `Welcome ${arrival ? "arrival" : "departure"} message failed for ${member.guild.id}`,
      error,
    );
  }
}

export function registerWelcomeRuntime(client: Client, store: WelcomeStore) {
  client.on(Events.GuildMemberAdd, (member) => sendWelcomeMessage(member, true, store));
  client.on(Events.GuildMemberRemove, (member) => sendWelcomeMessage(member, false, store));
}
