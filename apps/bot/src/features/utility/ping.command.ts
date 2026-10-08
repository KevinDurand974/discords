import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";

export const pingHelpDescription = [
  "Replies privately with pong, the WebSocket ping and response latency in milliseconds. No options or special permissions are required.",
  "Example: `/ping`",
] as const;

export const pingCommand = {
  helpDescription: pingHelpDescription,
  data: new SlashCommandBuilder().setName("ping").setDescription("Replies with pong!"),

  async execute(interaction) {
    const startedAt = performance.now();
    console.info("[DEBUG-ping-timing] received", {
      interactionId: interaction.id,
      interactionAgeMs: Date.now() - interaction.createdTimestamp,
    });
    const reply = await interaction.reply({
      content: "pong!",
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });

    const repliedAt = performance.now();
    console.info("[DEBUG-ping-timing] reply completed", {
      interactionId: interaction.id,
      replyMs: Math.round(repliedAt - startedAt),
    });

    await interaction.editReply(
      `pong!\nws: ${interaction.client.ws.ping}ms\nlatency: ${Math.max((reply.resource?.message?.createdTimestamp ?? 0) - interaction.createdTimestamp, 0)}ms`,
    );
    const editedAt = performance.now();
    console.info("[DEBUG-ping-timing] edit completed", {
      interactionId: interaction.id,
      editMs: Math.round(editedAt - repliedAt),
      totalMs: Math.round(editedAt - startedAt),
    });
  },
} satisfies CommandDefinition;
