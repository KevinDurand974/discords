import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  escapeMarkdown,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import {
  createPickSessionStore,
  parsePickChoices,
  PICK_INPUT_LIMIT,
  type PickSession,
} from "./pick-choice.ts";

const MODAL_PREFIX = "pick:form:";
const BUTTON_PREFIX = "pick:draw:";

export function createPickModal(userId: string) {
  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${userId}`)
    .setTitle("Pick an option")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Options")
        .setDescription("Enter 2–50 options, one per line; up to 100 characters each.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("choices")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(PICK_INPUT_LIMIT)
            .setPlaceholder("Pizza\nSalad\nPasta"),
        ),
    );
}

export function renderPickChoices(token: string, session: PickSession) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Pick an option\n${session.choices.map((choice) => escapeMarkdown(choice)).join("\n")}`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder());
  const drawn = session.result !== undefined;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      drawn
        ? `## Result\n${escapeMarkdown(session.choices[session.result!]!)}`
        : `Press **Get result** to select one option. Only <@${session.userId}> can draw. Expires in 15 minutes.`,
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BUTTON_PREFIX}${token}`)
        .setLabel("Get result")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(drawn),
    ),
  );
  return { components: [container], allowedMentions: { parse: [] as never[] } };
}

export function createPickComponentHandler(store = createPickSessionStore()): ComponentHandler {
  return {
    matches: (customId) => customId.startsWith(MODAL_PREFIX) || customId.startsWith(BUTTON_PREFIX),
    async execute(interaction) {
      if (interaction.isModalSubmit()) {
        if (interaction.customId !== `${MODAL_PREFIX}${interaction.user.id}`)
          throw new Error("This form belongs to another user. Run /pick to open your own form.");
        const choices = parsePickChoices(interaction.fields.getTextInputValue("choices"));
        const { token, session } = store.create(interaction.user.id, choices);
        try {
          await interaction.reply({
            ...renderPickChoices(token, session),
            flags: MessageFlags.IsComponentsV2,
          });
        } catch (error) {
          store.remove(token);
          throw error;
        }
      } else if (interaction.isButton()) {
        if (!interaction.customId.startsWith(BUTTON_PREFIX))
          throw new Error("Invalid pick button.");
        const token = interaction.customId.slice(BUTTON_PREFIX.length);
        const session = store.draw(token, interaction.user.id);
        await interaction.update(renderPickChoices(token, session));
      }
    },
  };
}

export const pickComponentHandler = createPickComponentHandler();
