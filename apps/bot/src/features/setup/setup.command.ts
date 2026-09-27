import {
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  configureNewsGroup,
  handleNewsSetup,
} from "@/features/netmarble-news/news-setup-command.ts";
import type {
  CommandDefinition,
  CommandExecutionContext,
  ComponentHandler,
} from "@/core/command.ts";

const DEFAULT_LOG_CHANNEL_NAME = "bot-command-logs";
const SETUP_LOGS_MODAL_ID = "setup:logs";
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
    ephemeral: true,
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
    .map((role) => ({
      id: role.id,
      allow: [PermissionFlagsBits.ViewChannel],
    }));

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
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
    command: "/setup logs",
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    status: "success",
  });
};

export const setupCommand = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure the bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommandGroup(configureNewsGroup)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("logs")
        .setDescription("Configure command logs")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Use an existing text channel")
            .addChannelTypes(ChannelType.GuildText),
        ),
    ),

  async execute(interaction, context) {
    if (interaction.options.getSubcommandGroup(false) === "news") {
      await handleNewsSetup(interaction);
      return;
    }
    assertCanConfigureLogs(interaction);
    const channel = interaction.options.getChannel("channel");

    if (channel?.type === ChannelType.GuildText) {
      await saveLogChannel(interaction, context, channel.id);
      return;
    }

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(SETUP_LOGS_MODAL_ID)
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

export const setupComponentHandler: ComponentHandler = {
  matches: (customId) => customId === SETUP_LOGS_MODAL_ID,

  async execute(interaction, context) {
    if (!interaction.isModalSubmit()) return;
    await createLogChannel(interaction, context);
  },
};
