import { Emoji, type Client } from "discord.js";

const categoryKeys = {
  guilds: "guild",
  tickets: "ticket",
  skills: "skill",
  enhancements: "enhancement",
  boxes: "box",
  chests: "chest",
  "limit-breaks": "limit",
  crystals: "crystal",
  exps: "exp",
  classes: "class",
  cores: "core",
  elements: "element",
  stars: "star",
  titles: "title",
  lvls: "lvl",
  ranks: "rank",
  unclassified: null,
} as const;

export type Category = keyof typeof categoryKeys;
export const category = Object.keys(categoryKeys) as Category[];

export const emojiMap = new Map<string, Emoji>();
export const emojiByCategory = new Map<Category, Emoji[]>();

type ClassifiedCategory = Exclude<Category, "unclassified">;

const categoryMatchers = Object.entries(categoryKeys).flatMap(([category, searchKey]) =>
  searchKey === null ? [] : [[category as ClassifiedCategory, searchKey] as const],
);

const getEmojiCategory = (name: string): Category =>
  categoryMatchers.find(([, searchKey]) => name.includes(searchKey))?.[0] ?? "unclassified";

const updateCategoryEmoji = (category: Category, emoji: Emoji) => {
  const currentItems = emojiByCategory.get(category);

  if (currentItems) {
    currentItems.push(emoji);
  } else {
    emojiByCategory.set(category, [emoji]);
  }
};

export const fetchEmojis = async (client: Client) => {
  const emojis = await client.application?.emojis.fetch();
  if (!emojis || emojis.size === 0) return;

  emojis.forEach((emoji) => {
    emojiMap.set(emoji.name, emoji);

    const emojiCategory = getEmojiCategory(emoji.name.toLocaleLowerCase());
    updateCategoryEmoji(emojiCategory, emoji);
  });

  console.log("[Emojis]", emojiMap.size, "loaded and cached");
};

type CachedEmoji<Name extends EmojiName> = Emoji & {
  name: Name;
  id: EmojiIdForName<Name>;
};

/**
 * Retourne un emoji déclaré dans `emojis.generated.d.ts`.
 *
 * Une erreur révèle que le cache n'a pas été chargé ou que les types doivent être
 * régénérés ; un emoji connu ne nécessite donc pas de contrôle `null` côté appelant.
 */
export const getEmojiByName = <Name extends EmojiName>(name: Name): CachedEmoji<Name> => {
  const emoji = emojiMap.get(name);

  if (!emoji) {
    throw new Error(
      `Emoji ${JSON.stringify(name)} is missing from the cache. Run generate:emojis and restart the bot.`,
    );
  }

  return emoji as CachedEmoji<Name>;
};

export const getEmojiByID = <Id extends EmojiId>(
  id: Id,
): Emoji & {
  name: EmojiNameForId<Id>;
  id: Id;
} => {
  const emoji = emojiMap.values().find((emoji) => emoji.id === id);

  if (!emoji) {
    throw new Error(
      `Emoji ID ${JSON.stringify(id)} is missing from the cache. Run generate:emojis and restart the bot.`,
    );
  }

  return emoji as Emoji & { name: EmojiNameForId<Id>; id: Id };
};

export const getEmojiByCategory = (category: Category) => {
  return emojiByCategory.get(category);
};

export const displayEmoji = (name: EmojiName) => {
  const emoji = getEmojiByName(name);
  return `<:${emoji.name}:${emoji.id}>`;
};
