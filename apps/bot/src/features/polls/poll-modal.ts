import {
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import { createPollFromForm } from "./poll.ts";

const POLL_MODAL_PREFIX = "poll:create:";
const pollChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
] as const;

export function createPollModal(interaction: ChatInputCommandInteraction) {
  const channel = new ChannelSelectMenuBuilder()
    .setCustomId("channel")
    .setChannelTypes(...pollChannelTypes)
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true);
  if (interaction.channel && pollChannelTypes.some((type) => type === interaction.channel?.type)) {
    channel.setDefaultChannels(interaction.channelId);
  }
  return new ModalBuilder()
    .setCustomId(`${POLL_MODAL_PREFIX}${interaction.user.id}`)
    .setTitle("Create poll")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Question")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("question")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(300),
        ),
      new LabelBuilder()
        .setLabel("Answers")
        .setDescription("Enter 2–10 distinct answers, one per line; up to 55 characters each.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("answers")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
            .setPlaceholder("Pizza\nSalad\nPasta"),
        ),
      new LabelBuilder()
        .setLabel("Duration in hours")
        .setDescription("A whole number from 1 to 768 (32 days). Leave empty for 24 hours.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("duration")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(3)
            .setValue("24"),
        ),
      new LabelBuilder()
        .setLabel("Voting mode")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("voting-mode")
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true)
            .addOptions(
              { label: "Single choice", value: "single", default: true },
              { label: "Multiple choice", value: "multiple" },
            ),
        ),
      new LabelBuilder()
        .setLabel("Post in channel")
        .setDescription("The current channel is selected by default when supported.")
        .setChannelSelectMenuComponent(channel),
    );
}

async function submitPoll(interaction: ModalSubmitInteraction) {
  if (!interaction.inGuild() || !interaction.guild) {
    throw new Error("Polls can only be created in a server.");
  }
  if (interaction.customId !== `${POLL_MODAL_PREFIX}${interaction.user.id}`) {
    throw new Error("This poll form belongs to another user. Run /poll to open your own form.");
  }
  const poll = createPollFromForm(
    interaction.fields.getTextInputValue("question"),
    interaction.fields.getTextInputValue("answers"),
    interaction.fields.getTextInputValue("duration"),
    interaction.fields.getStringSelectValues("voting-mode"),
  );
  const selected = interaction.fields
    .getSelectedChannels("channel", true, pollChannelTypes)
    .first();
  if (!selected) throw new Error("Select a destination channel for the poll.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await interaction.guild.channels.fetch(selected.id);
  if (
    !channel ||
    !pollChannelTypes.some((type) => type === channel.type) ||
    !channel.isSendable()
  ) {
    throw new Error("Choose a server text channel, announcement channel, or thread for the poll.");
  }
  if (channel.isThread() && (channel.archived || channel.locked)) {
    throw new Error("Polls cannot be created in archived or locked threads.");
  }
  const permissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendPolls,
    channel.isThread()
      ? PermissionFlagsBits.SendMessagesInThreads
      : PermissionFlagsBits.SendMessages,
  ];
  const [member, bot] = await Promise.all([
    interaction.guild.members.fetch(interaction.user.id),
    interaction.guild.members.fetchMe(),
  ]);
  if (!channel.permissionsFor(member)?.has(permissions)) {
    throw new Error(
      "You need View Channel, Send Messages, and Send Polls in the destination (Send Messages in Threads for a thread).",
    );
  }
  if (!channel.permissionsFor(bot)?.has(permissions)) {
    throw new Error(
      "The bot needs View Channel, Send Messages, and Send Polls in the destination (Send Messages in Threads for a thread).",
    );
  }
  if (channel.isThread() && channel.type === ChannelType.PrivateThread) {
    const canAccess = await Promise.all(
      [member, bot].map(async (actor) =>
        channel.permissionsFor(actor)?.has(PermissionFlagsBits.ManageThreads)
          ? true
          : Boolean(await channel.members.fetch(actor.id).catch(() => null)),
      ),
    );
    if (canAccess.some((allowed) => !allowed)) {
      throw new Error(
        "Both you and the bot must be members of the private thread or have Manage Threads.",
      );
    }
  }
  await channel.send({ poll, allowedMentions: { parse: [] } });
  await interaction.deleteReply();
}

export const pollComponentHandler = {
  matches: (customId) => customId.startsWith(POLL_MODAL_PREFIX),
  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;
    await submitPoll(interaction);
  },
} satisfies ComponentHandler;
