import { ChannelType, type ModalSubmitInteraction } from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import { createRuleComponents } from "./rule-components.ts";

export type RuleForm = {
  rules: string;
  name: string;
  channelId: string | undefined;
  roleId: string | undefined;
};

export function readRuleForm(interaction: ModalSubmitInteraction): RuleForm {
  const rules = interaction.fields.getTextInputValue("rules");
  const name = interaction.fields.getTextInputValue("channel-name").trim();
  const channelId = interaction.fields
    .getSelectedChannels("channel", false, [ChannelType.GuildText])
    ?.first()?.id;
  if (!rules.trim() || rules.length > 4000) {
    throw new UserFacingError("Rules must contain between 1 and 4000 characters.");
  }
  if (!channelId && (!name || name.length > 100)) {
    throw new UserFacingError("Select a channel or enter a new channel name (1–100 characters).");
  }
  const roleId = interaction.fields.getSelectedRoles("acceptance-role", false)?.first()?.id;
  createRuleComponents(rules, { guildId: interaction.guild!.id, roleId: roleId ?? "pending" });
  return { rules, name, channelId, roleId };
}
