import { Events, type Client, type Collection } from "discord.js";
import type { CommandDefinition, CommandExecutionContext, ComponentHandler } from "./command.ts";
import { replyWithError } from "./errors.ts";

export const registerInteractionRouter = (
  client: Client,
  commands: Collection<string, CommandDefinition>,
  componentHandlers: readonly ComponentHandler[],
  context: CommandExecutionContext,
) => {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      const commandPath = [
        interaction.commandName,
        interaction.options.getSubcommandGroup(false),
        interaction.options.getSubcommand(false),
      ]
        .filter((part): part is string => part !== null)
        .join(" ");
      const logEntry = {
        guildId: interaction.guildId ?? "",
        command: `/${commandPath}`,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
      };

      try {
        await command.execute(interaction, context);
        await context.commandLogger.log({ ...logEntry, status: "success" });
      } catch (error) {
        await context.commandLogger.log({ ...logEntry, status: "error" });
        await replyWithError(interaction, error);
      }
      return;
    }

    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    const handler = componentHandlers.find(({ matches }) => matches(interaction.customId));
    if (!handler) return;

    try {
      await handler.execute(interaction, context);
    } catch (error) {
      await replyWithError(interaction, error);
    }
  });
};
