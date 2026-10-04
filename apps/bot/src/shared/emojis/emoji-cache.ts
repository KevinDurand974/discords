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

export const couponItemList1: Record<string, EmojiName> = {
  "[Hunter] Mana Power Elixir I": "Mana_Power_Elixir_I",
  "[Hunter] Mana Power Elixir II": "Mana_Power_Elixir_II",
  "[Hunter] Mana Power Elixir III": "Mana_Power_Elixir_III",
  "Skill Scroll I": "Skill_Scroll_I",
  "Skill Scroll II": "Skill_Scroll_II",
  "Skill Scroll III": "Skill_Scroll_III",
  "[Player] Skill Scroll I": "Player_Skill_Scroll_I",
  "[Player] Skill Scroll II": "Player_Skill_Scroll_II",
  "[Player] Skill Scroll III": "Player_Skill_Scroll_III",
  "Shadow Skill Scroll I": "Shadow_Skill_Scroll_I",
  "Shadow Skill Scroll II": "Shadow_Skill_Scroll_II",
  "Shadow Skill Scroll III": "Shadow_Skill_Scroll_III",
  "Abyssal Fragment": "Abyssal_Fragment",
  "Abyssal Energy": "Abyssal_Energy",
  "Abyssal Essence": "Abyssal_Essence",
  "Shadow Energy": "Shadow_Energy",
  "Hunter Training Handbook": "Training_ClassTrainin",
  "Shadow Waves": "Shadow_Waves",
  "Abyssal Crystal": "Abyssal_Crystal",
  "Shadow Echoes": "Shadow_Echoes",
};

export const couponItemList2: Record<string, EmojiName> = {
  Design: "Design",
  "Precision Design": "Precision_Design",
  "Special Design": "Special_Design",
  "Artifact Enhancement Chip I": "Artifact_Enhancement_Chip_I",
  "Artifact Enhancement Chip II": "Artifact_Enhancement_Chip_II",
  "Artifact Enhancement Chip III": "Artifact_Enhancement_Chip_III",
  "Powder of Blessing": "Powder_of_Blessing",
  "Rune Fragment": "Rune_Fragment",
  "Low-tier Mana Crystal": "ManaSone_1",
  "Advanced Mana Crystal": "ManaSone_2",
  "Superior Mana Crystal": "Mana_Stone_3",
  "SR Hunter Exclusive Weapon Design": "SR_Hunter_Weapon_Design",
  "Hunter Exclusive Weapon Design": "Hunter_Weapon_Design",
  "Weapon Enhancement Gear I": "Weapon_Enhancement_Gear_I",
  "Weapon Enhancement Gear II": "Weapon_Enhancement_Gear_II",
  "Weapon Enhancement Gear III": "Weapon_Enhancement_Gear_III",
  "Core Aether I": "Core_Levelup_1",
  "Core Aether II": "Core_Levelup_2",
  "Core Aether III": "Core_Levelup_3",
  "Solidified Stone I": "Core_Enhance_1",
  "Solidified Stone II": "Core_Enhance_2",
  "Solidified Stone III": "Core_Enhance_3",
  "Condensed Energy I": "Core_LB_1",
  "Condensed Energy II": "Core_LB_2",
  "Condensed Energy III": "Core_LB_3",
};

export const couponItemList3: Record<string, EmojiName> = {
  "Time Crystal": "Time_Crystal",
  "Marks of Time I": "Marks_of_Time_I",
  "Marks of Time II": "Marks_of_Time_II",
  "Marks of Time III": "Marks_of_Time_III",
  "Amplification Agent": "Amplification_Agent",
  "Mana-imbued Fabric": "Mana_imbued_Fabric",
  "Mana Power Extract": "Relic",
  "Ice Melding Cube": "LimitBreak_Water",
  "Dark Melding Cube": "LimitBreak_Dark",
  "Holy Melding Cube": "LimitBreak_Light",
  "Wind Melding Cube": "LimitBreak_Wind",
  "Fire Melding Cube": "LimitBreak_Fire",
  "Advanced Ice Melding Cube": "LimitBreak_Water_2",
  "Advanced Dark Melding Cube": "LimitBreak_Dark_2",
  "Advanced Holy Melding Cube": "LimitBreak_Light_2",
  "Advanced Wind Melding Cube": "LimitBreak_Wind_2",
  "Advanced Fire Melding Cube": "LimitBreak_Fire_2",
  "Trace of Dimensions": "Trace_of_Dimensions",
  "Mana-imbued Ingot": "Mana_imbued_Ingot",
  "Ice Mana Power Crystal": "Ice_Mana_Power_Crystal",
  "Dark Mana Power Crystal": "Dark_Mana_Power_Crystal",
  "Holy Mana Power Crystal": "Holy_Mana_Power_Crystal",
  "Wind Mana Power Crystal": "Wind_Mana_Power_Crystal",
  "Fire Mana Power Crystal": "Fire_Mana_Power_Crystal",
};

export const couponItemList4: Record<string, EmojiName> = {
  "Lv. 100 Artifact Recipes": "LevelMaterial_100",
  "Lv. 120 Artifact Recipes": "LevelMaterial_120",
  "Artifact Fragments": "Artifact_Fragments",
  "[Lv. 90] Artifact Reforge Stone": "Reforge_90",
  "[Lv. 100] Artifact Reforge Stone": "Reforge_100",
  "[Lv. 120] Artifact Reforge Stone": "Reforge_120",
  "Luminous Prism I": "Luminous_I",
  "Luminous Prism II": "Luminous_II",
  "Artifact Enhancement Reset Ticket": "ArtifactReset",
  "Trace of Shadow": "Trace_of_Shadow",
};

export const couponItemList5: Record<string, EmojiName> = {
  "Dungeon Entry Keys": "Dungeon_Entry_Keys",
  "Hunters Association Honor Tokens": "Honor_Tokens",
  "Edge of Illusion and Dreams Key": "Dreams_Key",
  Diamond: "Diamond",
  "Essence Stones": "Essence_Stone",
  Gold: "Gold",
  "Workshop of Brilliant Light Invitation": "Workshop_Of_Brillant_Light",
  "Simulation Voucher": "Simulation_Voucher",
  "Guild Coins": "Guild_Point",
  "Rate Up Draw Ticket": "Rate_Up_Draw_Ticket",
  "Custom Draw Ticket": "Custom_Draw_Ticket",
  "Weapon Custom Draw Ticket": "Weapon_Custom_Draw_Ticket",
  "Tutorial Ticket": "Tutorial_Ticket",
  "Scout Ticket": "Scout_Ticket",
};

export const couponItems: Record<string, EmojiName> = {
  ...couponItemList1,
  ...couponItemList2,
  ...couponItemList3,
  ...couponItemList4,
  ...couponItemList5,
};

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
