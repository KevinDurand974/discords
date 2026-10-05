import { randomBytes } from "node:crypto";
import {
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  OverwriteType,
  escapeMarkdown,
  PermissionFlagsBits,
  type Guild,
  type OverwriteData,
  type User,
} from "discord.js";

export type TicketDetails = { title: string; description: string };
export const TICKET_TITLE_LIMIT = 100;
export const TICKET_DESCRIPTION_LIMIT = 4000;

export function validateTicket(title: string, description: string): TicketDetails {
  const details = { title: title.trim(), description: description.trim() };
  if (!details.title || details.title.length > TICKET_TITLE_LIMIT) {
    throw new Error("A ticket title is required and must contain between 1 and 100 characters.");
  }
  if (!details.description || details.description.length > TICKET_DESCRIPTION_LIMIT) {
    throw new Error(
      "A ticket description is required and must contain between 1 and 4000 characters.",
    );
  }
  return details;
}

export function ticketChannelName() {
  return `ticket-${randomBytes(3).toString("hex").slice(0, 5)}`;
}

export function ticketOwnerId(channel: { type: ChannelType; name: string; topic?: string | null }) {
  if (channel.type !== ChannelType.GuildText || !channel.name.startsWith("ticket-")) return null;
  const match = /^Support ticket opened by (\d{17,20})$/.exec(channel.topic ?? "");
  return match && match[0] === channel.topic ? (match[1] ?? null) : null;
}

export function ticketCards(details: TicketDetails, requesterId: string) {
  const heading = `## ${escapeMarkdown(details.title)}`;
  const footer = `-# Opened by <@${requesterId}>`;
  // Components V2 has a 4000-character combined text limit per message.
  const budget = 4000 - heading.length - footer.length;
  const descriptions = Array.from(details.description).reduce<string[]>(
    (parts, character) => {
      const index = parts.length - 1;
      if (parts[index]!.length + character.length > budget) parts.push(character);
      else parts[index] += character;
      return parts;
    },
    [""],
  );
  return descriptions.map((description) =>
    new ContainerBuilder()
      .setAccentColor(0x5865f2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(heading),
        new TextDisplayBuilder().setContent(description),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(footer)),
  );
}

export async function createTicket(guild: Guild, requester: User, input: TicketDetails) {
  const details = validateTicket(input.title, input.description);
  const bot = await guild.members.fetchMe();
  const required = [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.PinMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ];
  if (!bot.permissions.has(required)) {
    throw new Error(
      "The bot needs Manage Channels, View Channel, Send Messages, Pin Messages, and Read Message History to create tickets.",
    );
  }
  const roles = await guild.roles.fetch();
  const moderatorRoles = [...roles.values()].filter(
    (role) =>
      role.id !== guild.id &&
      !role.managed &&
      role.permissions.has(PermissionFlagsBits.ManageMessages),
  );
  const access = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ];
  const permissionOverwrites: OverwriteData[] = [
    { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    { id: bot.id, type: OverwriteType.Member, allow: [...access, PermissionFlagsBits.PinMessages] },
    { id: requester.id, type: OverwriteType.Member, allow: access },
    ...moderatorRoles.map((role) => ({ id: role.id, type: OverwriteType.Role, allow: access })),
  ];
  const channel = await guild.channels.create({
    name: ticketChannelName(),
    type: ChannelType.GuildText,
    topic: `Support ticket opened by ${requester.id}`,
    permissionOverwrites,
    reason: `Support ticket requested by ${requester.id}`,
  });
  try {
    const instructions = await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .setAccentColor(0x5865f2)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              "## How to close this ticket\nRun **/close-ticket** in this channel to schedule permanent deletion in **5 minutes**. Only the requester, moderators, and administrators can close it.\nUse **Close now** on the closure notice to delete immediately, or **Reopen** to cancel deletion. Repeating the command does not postpone deletion. **No archive or transcript is kept.**",
            ),
          ),
      ],
      allowedMentions: { parse: [] },
    });
    await instructions.pin("Ticket closure instructions");
    await ticketCards(details, requester.id).reduce(async (previous, card) => {
      await previous;
      await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [card],
        allowedMentions: { parse: [] },
      });
    }, Promise.resolve());
  } catch (error) {
    try {
      await channel.delete("Ticket initialization failed; removing incomplete private channel");
    } catch {
      throw new Error(
        "Unable to initialize the ticket or remove its empty channel. Ask a moderator to check the server's ticket channels.",
      );
    }
    throw error;
  }
  return channel;
}
