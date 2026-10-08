import { ContainerBuilder, MessageFlags, SeparatorBuilder, TextDisplayBuilder } from "discord.js";

import { UserFacingError } from "@/core/errors.ts";
import type { ReactionRoleMapping } from "./reaction-role-model.ts";

export const REACTION_ROLE_TITLE = "## 🎭 Choose your roles";

export function createReactionRoleMessage(
  content: string,
  mappings: readonly ReactionRoleMapping[] = [],
) {
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(REACTION_ROLE_TITLE))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  if (mappings.length) {
    const explanation = `**React to toggle a role**\n${mappings.map((mapping) => `${mapping.emoji} → <@&${mapping.roleId}>`).join("\n")}`;
    if (REACTION_ROLE_TITLE.length + content.length + explanation.length > 4000) {
      throw new UserFacingError(
        "The message and reaction role descriptions exceed 4000 characters. Shorten your message or use fewer reactions.",
      );
    }
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(explanation));
  }
  return container;
}

export function createReactionRoleMessagePayload(
  content: string,
  mappings: readonly ReactionRoleMapping[] = [],
) {
  return {
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] as const },
    components: [createReactionRoleMessage(content, mappings)],
  };
}

export function createReactionRoleNotice(content: string) {
  return {
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] as const },
    components: [new TextDisplayBuilder().setContent(content)],
  };
}
