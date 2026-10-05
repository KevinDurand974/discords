import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
} from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import type { TicketClosure } from "./ticket-closure-repository.ts";
import { changeTicketClosure } from "./ticket-runtime.ts";

const prefix = "ticket:closure:";
export function ticketClosureMessage(closure: TicketClosure) {
  const timestamp = Math.floor(closure.deleteAt.getTime() / 1000);
  const container = new ContainerBuilder()
    .addTextDisplayComponents((text) =>
      text.setContent(
        `# Ticket closing\nThis ticket will be permanently closed <t:${timestamp}:R>.\nYou can close it immediately or reopen it to cancel deletion. No archive or transcript will be kept.`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${prefix}close:${closure.closureId}`)
          .setLabel("Close now")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`${prefix}reopen:${closure.closureId}`)
          .setLabel("Reopen")
          .setStyle(ButtonStyle.Success),
      ),
    );
  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components: [container],
    allowedMentions: { parse: [] },
  };
}
export const ticketClosureComponentHandler = {
  matches(customId) {
    return customId.startsWith(prefix);
  },
  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.inGuild() || !interaction.guild)
      throw new Error("Ticket actions are only available in a server.");
    const match = /^ticket:closure:(close|reopen):([\da-f-]{36})$/.exec(interaction.customId);
    if (!match) throw new Error("Invalid ticket closure button.");
    const action = match[1] as "close" | "reopen";
    await interaction.deferUpdate();
    await changeTicketClosure(
      interaction.guild,
      interaction.channelId,
      interaction.user.id,
      match[2]!,
      action,
    );
    if (action === "reopen") await interaction.deleteReply();
  },
} satisfies ComponentHandler;
