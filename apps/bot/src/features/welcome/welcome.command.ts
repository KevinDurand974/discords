import {
  ChannelSelectMenuBuilder,
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
import type { CommandDefinition, ComponentHandler } from "@/core/command.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
import { getWelcomeStore, type WelcomeSettings, type WelcomeStore } from "./welcome-repository.ts";
import { DEFAULT_ARRIVAL_MESSAGE, createWelcomeMessageContainer } from "./welcome-messages.ts";

function assertCanConfigure(interaction: ChatInputCommandInteraction | ModalSubmitInteraction) {
  if (!interaction.inGuild() || !interaction.guild)
    throw new Error("Welcome messages can only be configured in a server.");
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    throw new Error("You need Manage Server to configure welcome messages.");
}

export function createWelcomeModal(
  userId: string,
  guildId: string,
  settings: WelcomeSettings | null = null,
) {
  const channel = new ChannelSelectMenuBuilder()
    .setId(2)
    .setCustomId("welcome-channel")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1)
    .setRequired(false);
  if (settings) channel.setDefaultChannels(settings.channelId);
  return new ModalBuilder()
    .setCustomId(`welcome:setup:v2:${userId}:${guildId}`)
    .setTitle("Welcome and departure messages")
    .addLabelComponents(
      new LabelBuilder()
        .setId(1)
        .setLabel("Existing arrival and departure channel")
        .setDescription("Leave empty to create a new text channel.")
        .setChannelSelectMenuComponent(channel),
      new LabelBuilder()
        .setId(3)
        .setLabel("New channel name")
        .setDescription("Used only when no existing channel is selected.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setId(4)
            .setCustomId("welcome-channel-name")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100)
            .setValue("welcome"),
        ),
      ...(
        [
          [
            "arrival-message",
            "Welcome message",
            settings?.arrivalMessage ?? DEFAULT_ARRIVAL_MESSAGE,
          ],
          [
            "departure-message",
            "Departure message",
            settings?.departureMessage ??
              "👋 **{user} has left the server.**\n\nThanks for being part of the community. See you around!",
          ],
        ] as const
      ).map(([id, label, value], index) =>
        new LabelBuilder()
          .setId(5 + index * 2)
          .setLabel(label)
          .setDescription(
            "Use {user}, {server}, {memberCount}. A standalone --- line adds a separator.",
          )
          .setTextInputComponent(
            new TextInputBuilder()
              .setId(6 + index * 2)
              .setCustomId(id)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMinLength(1)
              .setMaxLength(1000)
              .setValue(value),
          ),
      ),
    );
}

export async function saveWelcomeSettings(
  interaction: ModalSubmitInteraction,
  store: WelcomeStore,
) {
  assertCanConfigure(interaction);
  const guild = interaction.guild!;
  if (interaction.customId !== `welcome:setup:v2:${interaction.user.id}:${guild.id}`)
    throw new Error("This form belongs to another user or server. Run /welcome setup again.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channelId = interaction.fields
    .getSelectedChannels("welcome-channel", false, [ChannelType.GuildText])
    ?.first()?.id;
  const arrivalMessage = interaction.fields.getTextInputValue("arrival-message").trim();
  const departureMessage = interaction.fields.getTextInputValue("departure-message").trim();
  if (
    !arrivalMessage ||
    !departureMessage ||
    arrivalMessage.length > 1000 ||
    departureMessage.length > 1000
  )
    throw new Error("Both messages must contain between 1 and 1000 characters.");
  createWelcomeMessageContainer(arrivalMessage, true);
  createWelcomeMessageContainer(departureMessage, false);
  const bot = await guild.members.fetchMe();
  const channelName =
    interaction.fields.getTextInputValue("welcome-channel-name").trim() || "welcome";
  if (!channelId) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
      throw new Error("You need Manage Channels to create a welcome channel.");
    if (!bot.permissions.has(PermissionFlagsBits.ManageChannels))
      throw new Error("I need Manage Channels to create a welcome channel.");
    if (channelName.length > 100)
      throw new Error("The new channel name must be at most 100 characters.");
  }
  const channel = channelId
    ? await guild.channels.fetch(channelId)
    : await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: bot.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          },
        ],
        reason: `Welcome channel configured by ${interaction.user.id}`,
      });
  try {
    if (!channel || channel.type !== ChannelType.GuildText)
      throw new Error("Choose a text channel in this server.");
    if (
      !channel
        .permissionsFor(bot)
        ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
    )
      throw new Error("I need View Channel and Send Messages in the selected channel.");
    await store.save({
      guildId: guild.id,
      channelId: channel.id,
      arrivalMessage,
      departureMessage,
    });
  } catch (error) {
    if (!channelId && channel) {
      try {
        await channel.delete("Welcome setup failed");
      } catch (cleanupError) {
        console.error("Failed to remove incomplete welcome channel", cleanupError);
        throw new Error(
          "Welcome setup failed. Please delete the new channel manually and try again.",
          { cause: error },
        );
      }
    }
    throw error;
  }
  await editSuccessReply(interaction, {
    content: `Welcome and departure messages will be sent to <#${channel!.id}>.`,
  });
}

export async function resetWelcomeSettings(
  interaction: ChatInputCommandInteraction,
  store: WelcomeStore,
) {
  assertCanConfigure(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await store.reset(interaction.guildId!);
  await editSuccessReply(interaction, {
    content:
      "Welcome and departure messages are disabled. The channel and its messages were kept. Run /welcome setup to configure them again.",
  });
}

export const welcomeCommand = {
  helpDescription: [
    "Configure arrival and departure messages using a four-field modal: an optional existing text channel, a new channel name (default: welcome), welcome message, and departure message. Leave the selector empty to create a channel; otherwise the name is ignored. Run /welcome setup again to edit existing settings. Use /welcome reset to remove this server's saved configuration and disable notifications without deleting the channel or its messages.",
    "Requires Manage Server and the bot's Server Members Intent. Creating a channel additionally requires Manage Channels for both you and the bot. Use {user}, {server}, and {memberCount} (current server member count) placeholders. Standalone --- lines become V2 separators; messages must contain text and fit within 39 text/separator components. Settings survive restarts; the bot needs View Channel and Send Messages in the destination.",
    "Examples: `/welcome setup`, `/welcome reset`",
  ],
  data: new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Configure welcome and departure messages")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((command) =>
      command.setName("setup").setDescription("Configure welcome and departure messages"),
    )
    .addSubcommand((command) =>
      command.setName("reset").setDescription("Disable welcome messages and remove saved settings"),
    ),
  async execute(interaction) {
    assertCanConfigure(interaction);
    if (interaction.options.getSubcommand() === "reset") {
      await resetWelcomeSettings(interaction, getWelcomeStore());
      return;
    }
    const settings = await getWelcomeStore().get(interaction.guildId!);
    await interaction.showModal(
      createWelcomeModal(interaction.user.id, interaction.guildId!, settings),
    );
  },
} satisfies CommandDefinition;

export const welcomeComponentHandler = {
  matches: (customId) => customId.startsWith("welcome:setup:"),
  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;
    await saveWelcomeSettings(interaction, getWelcomeStore());
  },
} satisfies ComponentHandler;
