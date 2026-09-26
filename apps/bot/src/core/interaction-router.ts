import { Events, type Client, type Collection } from "discord.js";
import type { CommandDefinition, ComponentHandler } from "./command.ts";
import { replyWithError } from "./errors.ts";

export const registerInteractionRouter = (
  client: Client,
  commands: Collection<string, CommandDefinition>,
  componentHandlers: readonly ComponentHandler[],
) => {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        await replyWithError(interaction, error);
      }
      return;
    }

    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    const handler = componentHandlers.find(({ matches }) => matches(interaction.customId));
    if (!handler) return;

    try {
      await handler.execute(interaction);
    } catch (error) {
      await replyWithError(interaction, error);
    }
  });
};
