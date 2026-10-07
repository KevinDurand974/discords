import type { GuildMember, Role } from "discord.js";

export type ReactionRoleMapping = { emoji: string; key: string; roleId: string };
export const emojiKey = (emoji: { id: string | null; name: string | null }) =>
  emoji.id ?? (emoji.name ?? "").replace(/\uFE0F/g, "");

export function parseReactionEmoji(input: string): Pick<ReactionRoleMapping, "emoji" | "key"> {
  const emoji = input.trim();
  const custom = /^<a?:\w{2,32}:(\d{17,20})>$/.exec(emoji);
  if (!custom) {
    const graphemes = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(emoji)];
    if (
      graphemes.length !== 1 ||
      !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(emoji) ||
      !/^(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}0-9#*]|\u200d|\uFE0F|\uFE0E|\u20e3|[\u{E0020}-\u{E007F}])+$/u.test(
        emoji,
      )
    ) {
      throw new Error("Enter exactly one emoji, not text or multiple emojis.");
    }
  }
  return { emoji, key: custom?.[1] ?? emojiKey({ id: null, name: emoji }) };
}

export function parseReactionRoles(input: string): ReactionRoleMapping[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 1 || lines.length > 20) throw new Error("Enter 1–20 emoji - @role lines.");
  const mappings = lines.map((line) => {
    const match = /^(\S+)\s+-\s+<@&(\d{17,20})>$/.exec(line);
    if (!match) throw new Error("Use emoji - @role on each line (paste a role mention).");
    return { ...parseReactionEmoji(match[1]!), roleId: match[2]! };
  });
  if (new Set(mappings.map((mapping) => mapping.key)).size !== mappings.length) {
    throw new Error("Each emoji may appear only once.");
  }
  return mappings;
}

export function assertSafeReactionRole(role: Role, bot: GuildMember, publisher?: GuildMember) {
  if (
    role.id === role.guild.id ||
    role.managed ||
    !role.editable ||
    bot.roles.highest.comparePositionTo(role) <= 0
  ) {
    throw new Error("Choose unmanaged roles below the bot's highest role, not @everyone.");
  }
  if (
    publisher &&
    publisher.id !== role.guild.ownerId &&
    publisher.roles.highest.comparePositionTo(role) <= 0
  ) {
    throw new Error("Reaction roles must be below your highest role.");
  }
}
