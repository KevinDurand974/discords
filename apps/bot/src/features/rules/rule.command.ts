import {
  ChannelSelectMenuBuilder,
  ChannelType,
  InteractionContextType,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { CommandDefinition, ComponentHandler } from "@/core/command.ts";
import { UserFacingError } from "@/core/errors.ts";
import { DEFAULT_RULES } from "./default-rules.ts";
import { publishRules } from "./publish-rules.ts";
import { readRuleForm } from "./rule-form.ts";
import { RULE_DELETION_WARNING } from "./rule-warning.ts";

const RULE_MODAL_PREFIX = "rule:";

export function assertCanPublishRules(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
) {
  if (!interaction.inGuild() || !interaction.guild) {
    throw new UserFacingError("Use this command in a server.");
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    throw new UserFacingError("You need Manage Channels to publish rules.");
  }
}

export function createRuleModal(userId: string, guildId: string) {
  return new ModalBuilder()
    .setCustomId(`${RULE_MODAL_PREFIX}${userId}:${guildId}`)
    .setTitle("Publish server rules")
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(RULE_DELETION_WARNING))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Existing channel")
        .setDescription("Select a text channel, or leave empty to create one.")
        .setChannelSelectMenuComponent(
          new ChannelSelectMenuBuilder()
            .setCustomId("channel")
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(0)
            .setMaxValues(1)
            .setRequired(false),
        ),
      new LabelBuilder()
        .setLabel("New channel name")
        .setDescription("Used only when no existing channel is selected.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("channel-name")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100)
            .setValue("rules"),
        ),
      new LabelBuilder()
        .setLabel("Acceptance role")
        .setDescription(
          "Select an existing role, or leave empty to create green Rules ✓ (same permissions as @everyone).",
        )
        .setRoleSelectMenuComponent(
          new RoleSelectMenuBuilder()
            .setCustomId("acceptance-role")
            .setMinValues(0)
            .setMaxValues(1)
            .setRequired(false),
        ),
      new LabelBuilder()
        .setLabel("Server rules")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("rules")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000)
            .setValue(DEFAULT_RULES),
        ),
    );
}

export const ruleCommand = {
  helpDescription: [
    "Opens a modal with an optional text-channel selector, a new channel name (default: rules), and editable server rules prefilled with the default template (up to 4000 characters).",
    "Select an existing channel or leave the selector empty to create one. Publishes the rules as a single Markdown message without mentions; confirmation is private. WARNING: selecting an existing channel permanently deletes all its messages (including pinned and old messages) before publishing the new rules. Deletion cannot be undone; channel permissions remain unchanged.",
    "Server only; requires Manage Channels. In an existing destination both you and the bot need View Channel, Send Messages, Manage Messages, and Read Message History. For a new channel the bot needs Manage Channels, View Channel, and Send Messages.",
    "When creating a channel on a Community server, designates it as the server's Rules Channel (replacing any previous designation). Both you and the bot also need Manage Server. Non-Community servers and existing-channel selections do not change this setting.",
    "The editor displays the irreversible-deletion warning. Submitting it immediately replaces existing channel messages; there is no second confirmation step.",
    "Choose an acceptance role or leave empty to create green Rules ✓ with @everyone permissions. Both you and the bot need Manage Roles. Existing roles must be unmanaged, below both role hierarchies (server owner exempt), and grant no permissions beyond @everyone. The I understand and agree button assigns the role to the member who clicks it.",
    "Example: `/rules`",
  ],
  data: new SlashCommandBuilder()
    .setName("rules")
    .setDescription("Create or publish server rules")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  async execute(interaction) {
    assertCanPublishRules(interaction);
    await interaction.showModal(createRuleModal(interaction.user.id, interaction.guild!.id));
  },
} satisfies CommandDefinition;

export const ruleComponentHandler = {
  matches: (customId) => customId.startsWith(RULE_MODAL_PREFIX),
  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;
    assertCanPublishRules(interaction);
    if (
      interaction.customId !== `${RULE_MODAL_PREFIX}${interaction.user.id}:${interaction.guild!.id}`
    ) {
      throw new UserFacingError(
        "This form belongs to another user or server. Run /rules to open your own form.",
      );
    }
    const form = readRuleForm(interaction);
    await publishRules(interaction, form);
  },
} satisfies ComponentHandler;
