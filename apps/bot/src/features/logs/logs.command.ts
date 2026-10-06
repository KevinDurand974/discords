import {
  ChannelType,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type {
  CommandDefinition,
  CommandExecutionContext,
  ComponentHandler,
} from "@/core/command.ts";

const DEFAULT_LOG_CHANNEL_NAME = "bot-command-logs";
const LOGS_MODAL_ID = "setup:logs";
const CHANNEL_NAME_INPUT_ID = "channel-name";

const assertCanConfigureLogs = (
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
) => {
  if (!interaction.inGuild() || !interaction.guild) {
    throw new Error("This command can only be used in a server.");
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("You need the Manage Channels permission to configure command logs.");
  }
};

const saveLogChannel = async (
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  context: CommandExecutionContext,
  channelId: string,
) => {
  assertCanConfigureLogs(interaction);
  if (!interaction.guildId) {
    throw new Error("Unable to identify this server.");
  }
  await context.commandLogger.setChannel(interaction.guildId, channelId);
  await interaction.reply({
    content: `Command logs will now be sent to <#${channelId}>.`,
    flags: MessageFlags.Ephemeral,
  });
};

const createLogChannel = async (
  interaction: ModalSubmitInteraction,
  context: CommandExecutionContext,
) => {
  assertCanConfigureLogs(interaction);
  const guild = interaction.guild;
  if (!guild || !interaction.guildId) {
    throw new Error("Unable to identify this server.");
  }
  const channelName = interaction.fields.getTextInputValue(CHANNEL_NAME_INPUT_ID).trim();
  if (!channelName) throw new Error("The log channel name cannot be empty.");
  const botUserId = interaction.client.user?.id;
  if (!botUserId) throw new Error("The bot user is not available.");
  const managerRoleOverwrites = [...(await guild.roles.fetch()).values()]
    .filter(
      (role) => role.id !== guild.id && role.permissions.has(PermissionFlagsBits.ManageChannels),
    )
    .map((role) => ({ id: role.id, allow: [PermissionFlagsBits.ViewChannel] }));
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: botUserId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      ...managerRoleOverwrites,
    ],
    reason: `Command log channel configured by ${interaction.user.tag}`,
  });
  await saveLogChannel(interaction, context, channel.id);
  await context.commandLogger.log({
    guildId: interaction.guildId,
    command: "/logs",
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    status: "success",
  });
};

export const logsHelpDescription = [
  "Select an existing text channel or omit channel to create a private command-log channel via a modal. The default new channel name is bot-command-logs; confirmation is private.",
  "Server only; requires Manage Channels. Logging destinations are persisted per server. A deleted destination disables logging and must be reconfigured with /logs. Command logs contain the command path, user and status, not option values.",
  "Example: `/logs channel:#bot-logs`",
] as const;

export const logsCommand = {
  helpDescription: logsHelpDescription,
  data: new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configure command logs")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Use an existing text channel")
        .addChannelTypes(ChannelType.GuildText),
    ),
  async execute(interaction, context) {
    assertCanConfigureLogs(interaction);
    const channel = interaction.options.getChannel("channel");
    if (channel?.type === ChannelType.GuildText) {
      await saveLogChannel(interaction, context, channel.id);
      return;
    }
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(LOGS_MODAL_ID)
        .setTitle("Create command log channel")
        .addLabelComponents(
          new LabelBuilder()
            .setLabel("Channel name")
            .setDescription("A new text channel will be created")
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId(CHANNEL_NAME_INPUT_ID)
                .setStyle(TextInputStyle.Short)
                .setValue(DEFAULT_LOG_CHANNEL_NAME)
                .setRequired(true)
                .setMaxLength(100),
            ),
        ),
    );
  },
} satisfies CommandDefinition;

export const logsComponentHandler: ComponentHandler = {
  matches: (customId) => customId === LOGS_MODAL_ID,
  async execute(interaction, context) {
    if (!interaction.isModalSubmit()) return;
    await createLogChannel(interaction, context);
  },
};
