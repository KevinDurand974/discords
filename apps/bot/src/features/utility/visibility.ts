import {
  ChannelFlags,
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type ForumChannel,
  type GuildBasedChannel,
  type MediaChannel,
  type ModalSubmitInteraction,
  type NewsChannel,
  type TextChannel,
  type VoiceChannel,
} from "discord.js";

export const visibilityChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.GuildVoice,
] as const;

export const visibilityChoices = [
  {
    value: "default",
    label: "Default",
    description: "Channel content is always visible to members with channel access.",
  },
  {
    value: "spoiler",
    label: "Spoiler Channel",
    description: "Hide spoilers or sensitive discussions until users choose to view them.",
  },
  {
    value: "age-restricted",
    label: "Age-Restricted Channel",
    description: "Users must confirm they meet the legal age requirement to view this channel.",
  },
] as const;

export type Visibility = (typeof visibilityChoices)[number]["value"];
type VisibilityChannel = TextChannel | NewsChannel | ForumChannel | MediaChannel | VoiceChannel;

function isVisibilityChannel(channel: GuildBasedChannel): channel is VisibilityChannel {
  return visibilityChannelTypes.some((type) => channel.type === type);
}

export async function getVisibilityChannel(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  channelId: string,
): Promise<VisibilityChannel> {
  if (!interaction.inGuild() || !interaction.guild) {
    throw new Error("Channel visibility can only be configured in a server.");
  }
  const channel = await interaction.guild.channels.fetch(channelId, { force: true });
  if (!channel || channel.guildId !== interaction.guild.id || !isVisibilityChannel(channel)) {
    throw new Error(
      "Choose a text, announcement, forum, media or voice channel in this server. Threads inherit their parent channel's content restrictions.",
    );
  }
  const [member, bot] = await Promise.all([
    interaction.guild.members.fetch({ user: interaction.user.id, force: true }),
    interaction.guild.members.fetchMe({ force: true }),
  ]);
  const permissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels];
  if (!channel.permissionsFor(member)?.has(permissions)) {
    throw new Error(
      "You need View Channel and Manage Channels in this channel to configure visibility.",
    );
  }
  if (!channel.permissionsFor(bot)?.has(permissions)) {
    throw new Error(
      "The bot needs View Channel and Manage Channels in this channel to configure visibility.",
    );
  }
  return channel;
}

export function getChannelVisibility(channel: VisibilityChannel): Visibility {
  if (channel.nsfw) return "age-restricted";
  return channel.flags.has(ChannelFlags.IsSpoilerChannel) ? "spoiler" : "default";
}

export function parseVisibility(value: string): Visibility {
  const choice = visibilityChoices.find((option) => option.value === value);
  if (!choice) throw new Error("Select Default, Spoiler Channel or Age-Restricted Channel.");
  return choice.value;
}

export async function setChannelVisibility(
  channel: VisibilityChannel,
  visibility: Visibility,
  userId: string,
): Promise<void> {
  const flags = channel.flags.bitfield & ~ChannelFlags.IsSpoilerChannel;
  await channel.edit({
    nsfw: visibility === "age-restricted",
    flags: visibility === "spoiler" ? flags | ChannelFlags.IsSpoilerChannel : flags,
    reason: `Channel visibility requested by ${userId}`,
  });
}
