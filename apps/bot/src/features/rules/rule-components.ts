import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import { ruleAcceptanceCustomId } from "./rule-acceptance.ts";

export function createRuleComponents(
  rules: string,
  acceptance?: { guildId: string; roleId: string },
) {
  const sections = rules.split(/^[ \t]*---[ \t]*\r?$/m);
  const components = sections.flatMap((section, index) => [
    ...(section.trim() ? [new TextDisplayBuilder().setContent(section.trim())] : []),
    ...(index < sections.length - 1
      ? [new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)]
      : []),
  ]);
  if (!components.some((component) => component instanceof TextDisplayBuilder)) {
    throw new Error("Rules must contain text, not only separators.");
  }
  if (components.length > (acceptance ? 37 : 39)) {
    throw new Error("Too many rule sections. Use fewer separator lines.");
  }
  const container = new ContainerBuilder();
  components.forEach((component) => {
    if (component instanceof SeparatorBuilder) container.addSeparatorComponents(component);
    else container.addTextDisplayComponents(component);
  });
  if (acceptance) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(ruleAcceptanceCustomId(acceptance.guildId, acceptance.roleId))
          .setLabel("I understand and agree")
          .setStyle(ButtonStyle.Success),
      ),
    );
  }
  return [container];
}
