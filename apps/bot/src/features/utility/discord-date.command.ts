import { MessageFlags, SlashCommandBuilder, time, TimestampStyles } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { UserFacingError } from "@/core/errors.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
import { parseDiscordDate } from "./discord-date.ts";

export const discordDateCommand = {
  helpDescription: [
    "Converts a date to a Discord timestamp. Supports ISO dates, day/month/year numeric dates, and English/French dates or expressions such as tomorrow or demain. Ambiguous numeric dates use day/month/year; dates without a time use midnight.",
    "utc is the entered date's offset in hours from UTC (default 0, range -12 to +14; decimals such as 5.5 are supported). A timezone written in the date takes precedence. Discord displays the result in each viewer's local timezone.",
    "format offers all seven discord.js TimestampStyles: t (short time), T (long time), d (short date), D (long date), f (short date/time), F (long date/time, default), R (relative time). The ephemeral preview and copyable code remain visible for 30 seconds.",
    "Example: `/discord-date date:25/12/2026 18:30 utc:1 format:F`",
  ],
  data: new SlashCommandBuilder()
    .setName("discord-date")
    .setDescription("Convert a date into a copyable Discord timestamp")
    .addStringOption((option) =>
      option
        .setName("date")
        .setDescription("Date and optional time (e.g. 25/12/2026 18:30, ISO, tomorrow or demain)")
        .setRequired(true)
        .setMaxLength(200),
    )
    .addNumberOption((option) =>
      option
        .setName("utc")
        .setDescription("Date's UTC offset in hours (default 0; e.g. 1, -5 or 5.5)")
        .setMinValue(-12)
        .setMaxValue(14),
    )
    .addStringOption((option) =>
      option
        .setName("format")
        .setDescription("Timestamp display format (default: long date/time)")
        .addChoices(
          ...Object.entries(TimestampStyles).map(([name, value]) => ({
            name: `${name.replaceAll(/([a-z])([A-Z])/g, "$1 $2")} (${value})`,
            value,
          })),
        ),
    ),
  async execute(interaction) {
    const timestamp = parseDiscordDate(
      interaction.options.getString("date", true),
      interaction.options.getNumber("utc") ?? 0,
    );
    const format = interaction.options.getString("format") ?? TimestampStyles.LongDateTime;
    const style = Object.values(TimestampStyles).find((style) => style === format);
    if (!style) throw new UserFacingError("Choose a timestamp format from the list.");
    const rendered = time(timestamp, style);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await editSuccessReply(
      interaction,
      {
        content: `**Preview**\n${rendered}\n\n**Copy/paste**\n\`\`\`\n${rendered}\n\`\`\``,
        allowedMentions: { parse: [] },
      },
      30_000,
    );
  },
} satisfies CommandDefinition;
