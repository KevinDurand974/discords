import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export type ComponentInteraction = ButtonInteraction | ModalSubmitInteraction;

export type CommandLogEntry = {
  guildId: string;
  command: string;
  userId: string;
  userTag: string;
  status: "success" | "error";
};

export type CommandLogger = {
  setChannel(guildId: string, channelId: string): Promise<void>;
  log(entry: CommandLogEntry): Promise<void>;
};

export type CommandExecutionContext = {
  commandLogger: CommandLogger;
};

export type CommandDefinition = {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  helpDescription?: readonly string[];
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
  execute(
    interaction: ChatInputCommandInteraction,
    context: CommandExecutionContext,
  ): Promise<void>;
};

export type ComponentHandler = {
  matches(customId: string): boolean;
  execute(interaction: ComponentInteraction, context: CommandExecutionContext): Promise<void>;
};
