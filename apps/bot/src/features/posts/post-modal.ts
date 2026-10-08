import {
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits as P,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import { UserFacingError } from "@/core/errors.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
import { createPostMessage } from "./post-message.ts";

const PREFIX = "post:create:";
export const postChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
] as const;

export function createPostModal(interaction: ChatInputCommandInteraction) {
  const channel = new ChannelSelectMenuBuilder()
    .setCustomId("channel")
    .setChannelTypes(...postChannelTypes)
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true);
  if (interaction.channel && postChannelTypes.some((type) => type === interaction.channel?.type)) {
    channel.setDefaultChannels(interaction.channelId);
  }
  return new ModalBuilder()
    .setCustomId(`${PREFIX}${interaction.guildId}:${interaction.user.id}`)
    .setTitle("Create post")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Title")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("title")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(100),
        ),
      new LabelBuilder()
        .setLabel("Post content")
        .setDescription("Use --- for separators. Up to 19 become dividers; extra ones remain text.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("body")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(4000),
        ),
      new LabelBuilder()
        .setLabel("Post in channel")
        .setDescription("The current channel is selected by default when supported.")
        .setChannelSelectMenuComponent(channel),
    );
}

async function submitPost(interaction: ModalSubmitInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    throw new UserFacingError("Use this command in a server.");
  }
  if (interaction.customId !== `${PREFIX}${interaction.guildId}:${interaction.user.id}`) {
    throw new UserFacingError("This form is unavailable. Run /post again.");
  }
  const message = createPostMessage(
    interaction.fields.getTextInputValue("title"),
    interaction.fields.getTextInputValue("body"),
  );
  const selected = interaction.fields
    .getSelectedChannels("channel", true, postChannelTypes)
    .first();
  if (!selected) throw new UserFacingError("Select a destination channel for the post.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await interaction.guild.channels.fetch(selected.id);
  if (
    !channel ||
    channel.guildId !== interaction.guildId ||
    !postChannelTypes.some((type) => type === channel.type) ||
    !channel.isSendable()
  ) {
    throw new UserFacingError(
      "Choose a text channel, announcement channel, or thread in this server.",
    );
  }
  if (channel.isThread() && (channel.archived || channel.locked)) {
    throw new UserFacingError("Posts cannot be published in archived or locked threads.");
  }
  const permissions = [
    P.ViewChannel,
    channel.isThread() ? P.SendMessagesInThreads : P.SendMessages,
  ];
  const [member, bot] = await Promise.all([
    interaction.guild.members.fetch(interaction.user.id),
    interaction.guild.members.fetchMe(),
  ]);
  if (!channel.permissionsFor(member)?.has(permissions)) {
    throw new UserFacingError(
      "You need View Channel and Send Messages in the destination (Send Messages in Threads for a thread).",
    );
  }
  if (!channel.permissionsFor(bot)?.has(permissions)) {
    throw new UserFacingError(
      "The bot needs View Channel and Send Messages in the destination (Send Messages in Threads for a thread).",
    );
  }
  if (channel.isThread() && channel.type === ChannelType.PrivateThread) {
    const access = await Promise.all(
      [member, bot].map(async (actor) =>
        channel.permissionsFor(actor)?.has(P.ManageThreads)
          ? true
          : Boolean(await channel.members.fetch(actor.id).catch(() => null)),
      ),
    );
    if (access.some((allowed) => !allowed)) {
      throw new UserFacingError(
        "Both you and the bot must be members of the private thread or have Manage Threads.",
      );
    }
  }
  await channel.send(message);
  await editSuccessReply(interaction, {
    content: `Post published in <#${channel.id}>.`,
    allowedMentions: { parse: [] },
  });
}

export const postComponentHandler = {
  matches: (customId) => customId.startsWith(PREFIX),
  async execute(interaction) {
    if (interaction.isModalSubmit()) await submitPost(interaction);
  },
} satisfies ComponentHandler;
