import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
  time,
  TimestampStyles,
} from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { UserFacingError } from "@/core/errors.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
import { parseDiscordDate } from "./discord-date.ts";

export const discordDateCommand = {
  helpDescription: [
    "Converts a date to a Discord timestamp. Supports ISO dates, day/month/year numeric dates, and English/French dates or expressions such as tomorrow or demain. Ambiguous numeric dates use day/month/year; dd/MM uses the current year in the entered timezone, even if the date has passed. Dates without a time use midnight.",
    "utc is the entered date's offset in hours from UTC (default 0, range -12 to +14; decimals such as 5.5 are supported). A timezone written in the date takes precedence. Discord displays the result in each viewer's local timezone.",
    "format groups all nine discord.js TimestampStyles: F (full date/time, default), f (written date/time), s (numeric date/time), S (numeric date/time with seconds), D (written date), d (numeric date), t (short time), T (time with seconds), R (relative time). The ephemeral preview and copyable code remain visible for 60 seconds.",
    "Example: `/discord-date date:25/12/2026 18:30 utc:1 format:F`",
  ],
  data: new SlashCommandBuilder()
    .setName("discord-date")
    .setDescription("Convert a date into a copyable Discord timestamp")
    .addStringOption((option) =>
      option
        .setName("date")
        .setDescription(
          "Date: dd/MM (current year), dd/MM/YYYY or YYYY/MM/dd; optional HH:mm or h:mm AM/PM",
        )
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
          {
            name: "Date & time — full, with weekday (default, F)",
            value: TimestampStyles.LongDateTime,
          },
          { name: "Date & time — written month (f)", value: TimestampStyles.ShortDateTime },
          {
            name: "Date & time — numeric, hours and minutes (s)",
            value: TimestampStyles.ShortDateShortTime,
          },
          {
            name: "Date & time — numeric, with seconds (S)",
            value: TimestampStyles.ShortDateMediumTime,
          },
          { name: "Date only — written month (D)", value: TimestampStyles.LongDate },
          { name: "Date only — numeric (d)", value: TimestampStyles.ShortDate },
          { name: "Time only — hours and minutes (t)", value: TimestampStyles.ShortTime },
          { name: "Time only — with seconds (T)", value: TimestampStyles.LongTime },
          { name: "Relative — e.g. in 2 hours (R)", value: TimestampStyles.RelativeTime },
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
        flags: MessageFlags.IsComponentsV2,
        components: [
          new ContainerBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`**Preview**\n${rendered}`),
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`**Copy/paste**\n\`\`\`\n${rendered}\n\`\`\``),
            ),
        ],
        allowedMentions: { parse: [] },
      },
      60_000,
    );
  },
} satisfies CommandDefinition;
