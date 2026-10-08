import type { ChatInputCommandInteraction, InteractionEditReplyOptions } from "discord.js";

export async function editSuccessReply(
  interaction: Pick<ChatInputCommandInteraction, "editReply" | "deleteReply">,
  options: string | InteractionEditReplyOptions,
): Promise<void> {
  await interaction.editReply(options);
  setTimeout(() => {
    void Promise.resolve()
      .then(() => interaction.deleteReply())
      .catch(() => {});
  }, 10_000).unref();
}
