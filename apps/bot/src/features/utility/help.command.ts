import {
  ApplicationCommandOptionType,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";

type CommandOption = NonNullable<ReturnType<SlashCommandBuilder["toJSON"]>["options"]>[number];

function commandLines(
  path: string,
  description: string,
  options: readonly CommandOption[] = [],
): string[] {
  const subcommands = options.filter(
    (option) =>
      option.type === ApplicationCommandOptionType.Subcommand ||
      option.type === ApplicationCommandOptionType.SubcommandGroup,
  );
  if (subcommands.length) {
    return subcommands.flatMap((option) =>
      commandLines(`${path} ${option.name}`, option.description, option.options),
    );
  }
  const parameters = options.flatMap((option) => {
    if (
      option.type === ApplicationCommandOptionType.Subcommand ||
      option.type === ApplicationCommandOptionType.SubcommandGroup
    )
      return [];
    return [option.required ? `<${option.name}>` : `[${option.name}]`];
  });
  return [`- \`${[path, ...parameters].join(" ")}\` — ${description}`];
}

const HEADER =
  "# Help — bot commands\n`<parameter>` required · `[parameter]` optional\nSome commands require moderation or administrator permissions.";
const SECTION_LIMIT = 3700;
function splitSection(text: string) {
  const chunks: string[] = [];
  while (text.length > SECTION_LIMIT) {
    const newline = text.lastIndexOf("\n", SECTION_LIMIT);
    const end = newline > 0 ? newline : SECTION_LIMIT;
    chunks.push(text.slice(0, end));
    text = text.slice(end).trimStart();
  }
  if (text) chunks.push(text);
  return chunks;
}

export function renderHelp(commands: readonly CommandDefinition[]) {
  const sections = commands.flatMap(({ data }) => {
    const command = data.toJSON();
    return splitSection(
      `## /${command.name}\n${commandLines(`/${command.name}`, command.description, command.options).join("\n")}`,
    );
  });
  return renderHelpSections(sections);
}

function detailedCommandSections(
  path: string,
  description: string,
  options: readonly CommandOption[] = [],
): string[] {
  const subcommands = options.filter(
    (option) =>
      option.type === ApplicationCommandOptionType.Subcommand ||
      option.type === ApplicationCommandOptionType.SubcommandGroup,
  );
  if (subcommands.length)
    return subcommands.flatMap((option) =>
      detailedCommandSections(`${path} ${option.name}`, option.description, option.options),
    );
  const parameters = options.map((option) => {
    const limits = [
      "min_value" in option ? `minimum: ${option.min_value}` : undefined,
      "max_value" in option ? `maximum: ${option.max_value}` : undefined,
      "min_length" in option ? `minimum length: ${option.min_length}` : undefined,
      "max_length" in option ? `maximum length: ${option.max_length}` : undefined,
      "choices" in option && option.choices?.length
        ? `choices: ${option.choices.map((choice) => choice.name).join(", ")}`
        : undefined,
      "autocomplete" in option && option.autocomplete ? "autocomplete available" : undefined,
    ].filter(Boolean);
    return `- **${option.name}** (${option.required ? "required" : "optional"}): ${option.description}${limits.length ? ` — ${limits.join("; ")}` : ""}`;
  });
  return splitSection(
    `## Usage\n${commandLines(path, description, options).join("\n")}\n${parameters.length ? parameters.join("\n") : "No slash-command options."}`,
  );
}

export function renderCommandHelp(commands: readonly CommandDefinition[], name: string) {
  const definition = commands.find(({ data }) => data.name === name && data.name !== "help");
  if (!definition)
    throw new Error("Choose a command from the autocomplete list (excluding /help).");
  const command = definition.data.toJSON();
  const details = definition.helpDescription ?? [command.description];
  return renderHelpSections([
    ...splitSection(`## /${command.name} — detailed help\n${details.join("\n\n")}`),
    ...detailedCommandSections(`/${command.name}`, command.description, command.options),
  ]);
}

function renderHelpSections(sections: readonly string[]) {
  const pages: ContainerBuilder[] = [];
  let container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(HEADER),
  );
  let textLength = HEADER.length;
  let componentCount = 2; // Container + header, including nested components in the 40-component limit.
  for (const section of sections) {
    if (textLength + section.length > 4000 || componentCount + 2 > 40) {
      pages.push(container);
      container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(HEADER),
      );
      textLength = HEADER.length;
      componentCount = 2;
    }
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(section));
    textLength += section.length;
    componentCount += 2;
  }
  pages.push(container);
  return pages.map((page) => ({
    flags: MessageFlags.IsComponentsV2 as const,
    components: [page],
    allowedMentions: { parse: [] as const },
  }));
}

export function createHelpCommand(
  getCommands: () => readonly CommandDefinition[],
): CommandDefinition {
  return {
    data: new SlashCommandBuilder()
      .setName("help")
      .setDescription("Receive the command list or detailed help for one command by DM")
      .addStringOption((option) =>
        option
          .setName("command")
          .setDescription("Command to explain (leave empty for the full list)")
          .setAutocomplete(true),
      ),
    async autocomplete(interaction) {
      const query = interaction.options.getFocused().trim().toLowerCase().replace(/^\//, "");
      await interaction.respond(
        getCommands()
          .filter(({ data }) => data.name !== "help" && data.name.includes(query))
          .slice(0, 25)
          .map(({ data }) => ({ name: `/${data.name}`, value: data.name })),
      );
    },
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const selected = interaction.options
        .getString("command")
        ?.trim()
        .toLowerCase()
        .replace(/^\//, "");
      const messages =
        selected === undefined
          ? renderHelp(getCommands())
          : renderCommandHelp(getCommands(), selected);
      try {
        await messages.reduce(async (previous, message) => {
          await previous;
          await interaction.user.send(message);
        }, Promise.resolve());
      } catch {
        await interaction.editReply(
          selected === undefined
            ? "Unable to send you the complete command list by DM. Make sure your direct messages are enabled, then try /help again."
            : "Unable to send you detailed command help by DM. Make sure your direct messages are enabled, then try /help again.",
        );
        return;
      }
      await interaction.editReply(
        selected === undefined
          ? "The command list has been sent to you by DM."
          : `Detailed help for /${selected} has been sent to you by DM.`,
      );
    },
  };
}
