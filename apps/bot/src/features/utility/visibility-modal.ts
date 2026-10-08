import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  RadioGroupBuilder,
  TextDisplayBuilder,
} from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import type { ComponentHandler } from "@/core/command.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
import {
  getVisibilityChannel,
  parseVisibility,
  setChannelVisibility,
  visibilityChoices,
  type Visibility,
} from "./visibility.ts";

const VISIBILITY_MODAL_PREFIX = "visibility:";

export function createVisibilityModal(
  userId: string,
  guildId: string,
  channelId: string,
  current: Visibility,
) {
  return new ModalBuilder()
    .setCustomId(`${VISIBILITY_MODAL_PREFIX}${userId}:${guildId}:${channelId}`)
    .setTitle("Channel visibility")
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Channel: <#${channelId}>\nThis changes content warnings, not channel access permissions.`,
      ),
    )
    .addLabelComponents(
      new LabelBuilder().setLabel("Content Visibility").setRadioGroupComponent(
        new RadioGroupBuilder()
          .setCustomId("visibility")
          .setRequired(true)
          .addOptions(
            ...visibilityChoices.map((choice) => ({
              ...choice,
              default: choice.value === current,
            })),
          ),
      ),
    );
}

export const visibilityComponentHandler = {
  matches: (customId) => customId.startsWith(VISIBILITY_MODAL_PREFIX),
  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.inGuild() || !interaction.guild) {
      throw new UserFacingError("Use this command in a server.");
    }
    const [prefix, userId, guildId, channelId, extra] = interaction.customId.split(":");
    if (
      prefix !== "visibility" ||
      !channelId ||
      extra !== undefined ||
      userId !== interaction.user.id ||
      guildId !== interaction.guild.id
    ) {
      throw new UserFacingError(
        "This visibility form belongs to another user or server. Run /visibility to open your own form.",
      );
    }
    const visibility = parseVisibility(interaction.fields.getRadioGroup("visibility", true));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await getVisibilityChannel(interaction, channelId);
    await setChannelVisibility(channel, visibility, interaction.user.id);
    const choice = visibilityChoices.find((option) => option.value === visibility)!;
    await editSuccessReply(interaction, {
      content: `Content visibility for <#${channel.id}> set to **${choice.label}**.`,
      allowedMentions: { parse: [] },
    });
  },
} satisfies ComponentHandler;
