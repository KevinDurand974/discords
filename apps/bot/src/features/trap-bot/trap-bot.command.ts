import {
  InteractionContextType,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits as P,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { CommandDefinition, ComponentHandler } from "@/core/command.ts";
import { getTrapStore } from "./trap-repository.ts";
import { createTrapChannel } from "./trap-service.ts";

export function createTrapModal(userId: string, guildId: string) {
  return new ModalBuilder()
    .setCustomId(`trap:create:${userId}:${guildId}`)
    .setTitle("Create a bot trap")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Channel name")
        .setDescription("Posting without a role in this channel causes an automatic ban.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("trap-channel-name")
            .setStyle(TextInputStyle.Short)
            .setValue("trap")
            .setMinLength(1)
            .setMaxLength(100)
            .setRequired(true),
        ),
    );
}

export const trapBotCommand = {
  helpDescription: [
    "Opens a modal to name a writable bot trap channel (default: trap) with a Components V2 warning. Posting any message there without a server role causes an immediate automatic ban (humans included). @everyone does not count; any other role exempts the account.",
    "Server only; the publisher needs Manage Channels and Ban Members. The bot also needs Manage Roles to configure channel overwrites. Server owners, administrators, webhooks, system messages, and the bot itself are exempt. Rules ✓ roles are denied View Channel; administrators can bypass this as usual.",
    "Configuration survives restarts. Use /untrap to remove the channel and stored configuration, or delete the channel manually to disable it. The bot attempts to DM the ban reason, then deletes the banned account's trap messages without deleting history elsewhere. Bans are logged through /logs when configured. Requires the database migration and Guild Messages intent, but no privileged intents.",
    "Example: `/trap`",
  ],
  data: new SlashCommandBuilder()
    .setName("trap")
    .setDescription("Create a bot trap: posting without a role triggers an automatic ban")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(P.ManageChannels | P.BanMembers),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) throw new Error("Bot traps are server-only.");
    if (!interaction.memberPermissions?.has([P.ManageChannels, P.BanMembers]))
      throw new Error("You need Manage Channels and Ban Members to configure a bot trap.");
    await interaction.showModal(createTrapModal(interaction.user.id, interaction.guild.id));
  },
} satisfies CommandDefinition;

export const trapComponentHandler = {
  matches: (customId) => customId.startsWith("trap:create:"),
  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;
    if (
      !interaction.inGuild() ||
      !interaction.guild ||
      interaction.customId !== `trap:create:${interaction.user.id}:${interaction.guild.id}`
    )
      throw new Error(
        "This form belongs to another user or server. Run /trap to open your own form.",
      );
    await createTrapChannel(
      interaction,
      getTrapStore(),
      interaction.fields.getTextInputValue("trap-channel-name"),
    );
  },
} satisfies ComponentHandler;
