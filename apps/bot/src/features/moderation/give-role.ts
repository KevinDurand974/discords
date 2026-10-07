import type { ChatInputCommandInteraction } from "discord.js";
import { changeMemberRole } from "./change-member-role.ts";

export async function giveRole(interaction: ChatInputCommandInteraction) {
  await changeMemberRole(interaction, "give");
}
