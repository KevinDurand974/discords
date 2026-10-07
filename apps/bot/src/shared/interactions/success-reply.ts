import type { ChatInputCommandInteraction, InteractionEditReplyOptions } from "discord.js";

export async function editSuccessReply(
  interaction: Pick<ChatInputCommandInteraction, "editReply" | "deleteReply">,
  options: InteractionEditReplyOptions,
): Promise<void> {
  await interaction.editReply(options);
  setTimeout(() => {
    void interaction.deleteReply().catch(() => {});
  }, 10_000).unref();
}
