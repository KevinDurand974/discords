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
      .setDescription("Receive the full command list by direct message"),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        for (const message of renderHelp(getCommands())) await interaction.user.send(message);
      } catch {
        await interaction.editReply(
          "Unable to send you the complete command list by DM. Make sure your direct messages are enabled, then try /help again.",
        );
        return;
      }
      await interaction.editReply("The command list has been sent to you by DM.");
    },
  };
}
